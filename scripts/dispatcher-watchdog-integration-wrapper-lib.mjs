import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRunId } from "./dispatcher-watchdog-integration-resources.mjs";
import { ESBUILD_STAGING_ROOT_ENV } from "./dispatcher-watchdog-external-esbuild-staging.mjs";
import {
  buildRunnerSourceSnapshot,
  collectLinuxRunnerPackageClosure,
  inspectLinuxRunnerDependencyReadiness,
  stageOfflineNodeModules,
} from "./dispatcher-watchdog-runner-snapshot.mjs";
import { expectedDisposablePgHostname } from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";

export const EXPECTED_REPO_ROOT = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
export const EXPECTED_BRANCH = "main";
export const EXPECTED_HEAD = "a95a8c5d27dfe2cf954ebd60a78189743d6aa70a";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;

/** Approved disposable integration images (repository@digest only). */
export const APPROVED_INTEGRATION_POSTGRES_IMAGE_REF =
  "postgres@sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166";
export const APPROVED_INTEGRATION_RUNNER_IMAGE_REF =
  "node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402";

export function normalizeRepoPath(path) {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
}

export function assertPinnedImageReference(imageRef, kind) {
  const trimmed = String(imageRef ?? "").trim();
  if (!trimmed) {
    throw new Error(`integration_image_missing:${kind}`);
  }
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) {
    throw new Error(`integration_image_digest_missing:${kind}`);
  }
  const digest = trimmed.slice(at + 1);
  if (!SHA256_DIGEST.test(digest)) {
    throw new Error(`integration_image_digest_invalid:${kind}`);
  }
  const name = trimmed.slice(0, at);
  if (name.includes(":")) {
    throw new Error(`integration_image_compound_reference_rejected:${kind}`);
  }
  if (kind === "postgres" && name !== "postgres") {
    throw new Error("integration_postgres_image_must_be_postgres_repo");
  }
  if (kind === "runner" && name !== "node") {
    throw new Error("integration_runner_image_must_be_node_repo");
  }
  return trimmed;
}

export function assertGitPreflight(repoRoot = EXPECTED_REPO_ROOT) {
  const top = execSync("git rev-parse --show-toplevel", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (normalizeRepoPath(top) !== normalizeRepoPath(EXPECTED_REPO_ROOT)) {
    throw new Error("integration_git_root_mismatch");
  }
  const branch = execSync("git branch --show-current", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (branch !== EXPECTED_BRANCH) {
    throw new Error("integration_git_branch_mismatch");
  }
  const head = execSync("git rev-parse HEAD", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (head !== EXPECTED_HEAD) {
    throw new Error("integration_git_head_mismatch");
  }
  return { repoRoot: top, branch, head };
}

export function resolveRunIdFromEnv(env = process.env) {
  const fromEnv = env.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID?.trim();
  if (fromEnv) {
    return validateRunId(fromEnv);
  }
  throw new Error("dispatcher_watchdog_run_id_required_for_integration_wrapper");
}

export function buildDisposableIntegrationEnv({
  runId,
  pgUser,
  pgPassword,
  pgDatabase,
}) {
  const id = validateRunId(runId);
  const host = expectedDisposablePgHostname(id);
  const user = String(pgUser ?? "").trim();
  const password = String(pgPassword ?? "").trim();
  const database = String(pgDatabase ?? "").trim();
  if (!user || !password || !database) {
    throw new Error("integration_pg_credentials_incomplete");
  }
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/${encodeURIComponent(database)}`;
  return {
    MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "disposable-local-only",
    MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: id,
    MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: host,
    MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: url,
  };
}

export function assertOfflineRunnerDependencies(repoRoot = EXPECTED_REPO_ROOT, env = process.env) {
  if (!existsSync(resolve(repoRoot, "node_modules/tsx"))) {
    throw new Error("offline_dependency_missing:tsx");
  }
  if (!existsSync(resolve(repoRoot, "node_modules/@neondatabase/serverless"))) {
    throw new Error("offline_dependency_missing:@neondatabase/serverless");
  }
  const packages = collectLinuxRunnerPackageClosure(repoRoot, undefined, undefined, env);
  return { packageCount: packages.length };
}

export function assertLinuxRunnerStagingReadiness(repoRoot = EXPECTED_REPO_ROOT, env = process.env) {
  const report = inspectLinuxRunnerDependencyReadiness(repoRoot, undefined, undefined, env);
  if (!report.linuxRunnerStagingClosurePassed) {
    throw new Error(report.linuxRunnerStagingClosureError ?? "linux_runner_staging_closure_failed");
  }
  return report;
}

export function prepareRunnerWorkspace(
  outputDir,
  repoRoot = EXPECTED_REPO_ROOT,
  env = process.env,
) {
  const snapshot = buildRunnerSourceSnapshot(outputDir, repoRoot);
  const offline = stageOfflineNodeModules(outputDir, repoRoot, undefined, undefined, env);
  return { ...snapshot, ...offline };
}

export { ESBUILD_STAGING_ROOT_ENV };

export {
  assertIntegrationExecuteAuthorization,
  assertLocalPinnedIntegrationImages,
  assertLocalPinnedImage,
  INTEGRATION_EXECUTE_AUTH_ENV,
  INTEGRATION_EXECUTE_AUTH_VALUE,
  PREFLIGHT_PHASES_BEFORE_DOCKER_MUTATION,
  PHASES_BEFORE_DISPOSABLE_SQL,
  validateImageInspectForPinnedReference,
  imageInspectMatchesPinnedDigest,
  pinnedDigestFromReference,
} from "./dispatcher-watchdog-integration-image-preflight.mjs";

export {
  buildPostgresDisposableRunArgv,
  buildRunnerDisposableRunArgv,
  assertDockerRunUsesPullNever,
  DOCKER_RUN_PULL_NEVER,
} from "./dispatcher-watchdog-integration-docker-run.mjs";
