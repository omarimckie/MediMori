import cp from "node:child_process";
import { assertPinnedImageReference } from "./dispatcher-watchdog-integration-wrapper-lib.mjs";

export const INTEGRATION_EXECUTE_AUTH_ENV = "MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUN_AUTHORIZED";
export const INTEGRATION_EXECUTE_AUTH_VALUE = "execute";

/** Phases that must complete before any Docker network/container mutation. */
export const PREFLIGHT_PHASES_BEFORE_DOCKER_MUTATION = [
  "integration_execute_authorization",
  "git_preflight",
  "run_id",
  "pinned_image_syntax",
  "disposable_database_env",
  "disposable_database_url_resolver",
  "offline_runner_dependencies",
  "linux_runner_staging_readiness",
  "local_pinned_images",
];

/** Phases after containers exist; SQL must not run before isolation validation. */
export const PHASES_BEFORE_DISPOSABLE_SQL = [
  ...PREFLIGHT_PHASES_BEFORE_DOCKER_MUTATION,
  "docker_network_create",
  "postgres_container_create",
  "postgres_isolation_validate",
  "postgres_container_identity",
  "disposable_database_url_bind",
  "postgres_readiness",
  "runner_container_create",
  "runner_isolation_validate",
];

/**
 * @param {Record<string, string | undefined>} env
 */
export function assertIntegrationExecuteAuthorization(env = process.env) {
  if (env[INTEGRATION_EXECUTE_AUTH_ENV] !== INTEGRATION_EXECUTE_AUTH_VALUE) {
    throw new Error("integration_execute_authorization_required");
  }
}

/**
 * @param {string} digest
 */
export function normalizeSha256Digest(digest) {
  const trimmed = String(digest ?? "").trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("sha256:") ? trimmed : `sha256:${trimmed}`;
}

/**
 * @param {string} imageRef
 */
export function pinnedDigestFromReference(imageRef) {
  const trimmed = String(imageRef ?? "").trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) {
    throw new Error("integration_image_digest_missing");
  }
  return normalizeSha256Digest(trimmed.slice(at + 1));
}

/**
 * @param {unknown} inspect
 * @param {string} pinnedDigest
 */
export function imageInspectMatchesPinnedDigest(inspect, pinnedDigest) {
  const want = normalizeSha256Digest(pinnedDigest);
  const record = inspect && typeof inspect === "object" ? inspect : {};
  const id = normalizeSha256Digest(record.Id ?? "");
  const descriptorDigest = record.Descriptor?.digest
    ? normalizeSha256Digest(record.Descriptor.digest)
    : "";
  const repoDigests = Array.isArray(record.RepoDigests)
    ? record.RepoDigests.map((entry) => {
        const text = String(entry);
        const at = text.lastIndexOf("@");
        const digestPart = at >= 0 ? text.slice(at + 1) : text;
        return normalizeSha256Digest(digestPart);
      })
    : [];

  if (id === want || descriptorDigest === want) {
    return true;
  }
  if (repoDigests.includes(want)) {
    return true;
  }
  const wantHex = want.replace(/^sha256:/, "");
  const idHex = id.replace(/^sha256:/, "");
  return idHex === wantHex;
}

/**
 * @param {unknown} inspect
 * @param {"postgres" | "runner"} kind
 */
export function assertOfficialImageRepository(inspect, kind) {
  const record = inspect && typeof inspect === "object" ? inspect : {};
  const pulls = Array.isArray(record.Identity?.Pull) ? record.Identity.Pull : [];
  const repository = String(pulls[0]?.Repository ?? "");
  if (kind === "postgres" && repository.includes("postgres")) {
    return;
  }
  if (kind === "runner" && repository.includes("node")) {
    return;
  }
  const repoDigests = Array.isArray(record.RepoDigests) ? record.RepoDigests : [];
  if (kind === "postgres" && repoDigests.some((entry) => String(entry).startsWith("postgres@"))) {
    return;
  }
  if (kind === "runner" && repoDigests.some((entry) => String(entry).startsWith("node@"))) {
    return;
  }
  throw new Error(`integration_image_repo_not_official:${kind}`);
}

/**
 * @param {unknown} inspect
 */
export function assertLinuxAmd64Platform(inspect) {
  const record = inspect && typeof inspect === "object" ? inspect : {};
  if (record.Os !== "linux") {
    throw new Error("integration_image_os_not_linux");
  }
  if (record.Architecture !== "amd64") {
    throw new Error("integration_image_arch_not_amd64");
  }
}

/**
 * @param {unknown} inspect
 */
export function assertPostgresMajorVersion16(inspect) {
  const env = Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env : [];
  const pgMajor = env.find((entry) => String(entry).startsWith("PG_MAJOR="));
  if (pgMajor !== "PG_MAJOR=16") {
    throw new Error("integration_postgres_major_not_16");
  }
}

/**
 * @param {unknown} inspect
 */
export function assertRunnerNode22AlpineFamily(inspect) {
  const env = Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env : [];
  const nodeVersion = env.find((entry) => String(entry).startsWith("NODE_VERSION="));
  if (!nodeVersion || !nodeVersion.startsWith("NODE_VERSION=22")) {
    throw new Error("integration_runner_node_version_not_22");
  }
  if (env.some((entry) => String(entry).startsWith("PG_MAJOR="))) {
    throw new Error("integration_runner_image_family_invalid");
  }
  const baseName =
    inspect?.Descriptor?.annotations?.["org.opencontainers.image.base.name"] ??
    inspect?.Config?.Labels?.["org.opencontainers.image.base.name"];
  if (baseName && !String(baseName).toLowerCase().includes("alpine")) {
    throw new Error("integration_runner_not_alpine_family");
  }
}

/**
 * @param {unknown} inspect
 * @param {string} imageRef
 * @param {"postgres" | "runner"} kind
 */
export function assertInspectRepoDigestReference(inspect, imageRef, kind) {
  const pinned = String(imageRef ?? "").trim();
  const repoDigests = Array.isArray(inspect?.RepoDigests)
    ? inspect.RepoDigests.map((entry) => String(entry))
    : [];
  if (!repoDigests.includes(pinned)) {
    throw new Error(`integration_image_repo_digest_mismatch:${kind}`);
  }
}

/**
 * @param {unknown} inspect
 * @param {string} imageRef
 * @param {"postgres" | "runner"} kind
 */
export function validateImageInspectForPinnedReference(inspect, imageRef, kind) {
  const pinned = assertPinnedImageReference(imageRef, kind);
  const digest = pinnedDigestFromReference(pinned);
  if (!imageInspectMatchesPinnedDigest(inspect, digest)) {
    throw new Error(`integration_image_digest_mismatch:${kind}`);
  }
  assertInspectRepoDigestReference(inspect, pinned, kind);
  assertOfficialImageRepository(inspect, kind);
  assertLinuxAmd64Platform(inspect);
  if (kind === "postgres") {
    assertPostgresMajorVersion16(inspect);
  } else {
    assertRunnerNode22AlpineFamily(inspect);
  }
  return pinned;
}

/**
 * @param {string} imageRef
 */
export function fetchLocalImageInspectRecord(imageRef) {
  try {
    const output = cp.execFileSync("docker", ["image", "inspect", imageRef], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("integration_image_inspect_empty");
    }
    return parsed[0];
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
    if (
      (error && typeof error === "object" && "status" in error && error.status === 1) ||
      message.includes("No such image")
    ) {
      throw new Error("integration_image_not_local");
    }
    throw error;
  }
}

/**
 * @param {string} imageRef
 * @param {"postgres" | "runner"} kind
 */
export function assertLocalPinnedImage(imageRef, kind) {
  assertPinnedImageReference(imageRef, kind);
  const inspect = fetchLocalImageInspectRecord(imageRef);
  return validateImageInspectForPinnedReference(inspect, imageRef, kind);
}

/**
 * @param {string} postgresImageRef
 * @param {string} runnerImageRef
 */
export function assertLocalPinnedIntegrationImages(postgresImageRef, runnerImageRef) {
  assertLocalPinnedImage(postgresImageRef, "postgres");
  assertLocalPinnedImage(runnerImageRef, "runner");
}
