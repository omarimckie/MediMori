import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRunId } from "./dispatcher-watchdog-integration-resources.mjs";
import { ESBUILD_STAGING_ROOT_ENV } from "./dispatcher-watchdog-external-esbuild-staging.mjs";
import {
  buildRunnerSourceSnapshot,
  collectLinuxRunnerPackageClosure,
  inspectLinuxRunnerDependencyReadiness,
  RUNNER_SOURCE_ALLOWLIST,
  stageOfflineNodeModules,
} from "./dispatcher-watchdog-runner-snapshot.mjs";
import { expectedDisposablePgHostname } from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";

export const EXPECTED_REPO_ROOT = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
export const EXPECTED_BRANCH = "main";

/** Marker paths that must exist in the integration harness at HEAD. */
export const INTEGRATION_REPOSITORY_MARKERS = [
  "scripts/dispatcher-watchdog-integration-wrapper-lib.mjs",
  "scripts/run-dispatcher-watchdog-postgres-integration.ps1",
  "scripts/dispatcher-watchdog-runner-snapshot.mjs",
  "scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs",
  "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
  "src/lib/marketing/reliability/qstash-primary/qstash-primary-postgres.integration.test.ts",
];

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const DUBIOUS_OWNERSHIP = /dubious ownership/i;

export function resolveIntegrationRepoRoot(repoRoot) {
  if (repoRoot != null && String(repoRoot).trim()) {
    return resolve(repoRoot);
  }
  const fromEnv = process.env.WD_INTEGRATION_REPO_ROOT?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return EXPECTED_REPO_ROOT;
}

/**
 * True when repoRoot is the resolved top-level integration harness checkout.
 */
export function validateIntegrationRepositoryRoot(repoRoot) {
  const root = resolve(repoRoot);
  if (!existsSync(resolve(root, INTEGRATION_REPOSITORY_MARKERS[0]))) {
    return false;
  }
  if (!existsSync(resolve(root, INTEGRATION_REPOSITORY_MARKERS[1]))) {
    return false;
  }
  return true;
}

function formatGitCommandFailure(args, error) {
  const stderr = String(error?.stderr ?? error?.message ?? error ?? "").trim();
  const code = error?.status ?? error?.code ?? "unknown";
  return `integration_git_command_failed:${args.join(" ")}:${code}:${stderr}`;
}

function spawnIntegrationGit(repoRoot, gitArgv, options = {}) {
  const encoding = options.encoding ?? "utf8";
  const result = spawnSync("git", gitArgv, {
    cwd: repoRoot,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error) {
    const err = result.error;
    err.stderr = result.stderr;
    throw err;
  }
  if (result.status !== 0) {
    const err = new Error(String(result.stderr ?? result.stdout ?? "git failed").trim());
    err.status = result.status;
    err.stderr = result.stderr;
    throw err;
  }
  return result.stdout;
}

/**
 * Run git in repoRoot. For validated integration checkouts only, retry once with
 * an invocation-scoped safe.directory when Git reports dubious ownership.
 */
export function runIntegrationGit(repoRoot, args, options = {}) {
  const root = resolveIntegrationRepoRoot(repoRoot);
  if (!validateIntegrationRepositoryRoot(root)) {
    throw new Error("integration_repository_root_invalid");
  }
  const encoding = options.encoding ?? "utf8";
  const baseOpts = {
    cwd: root,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  };
  try {
    return spawnIntegrationGit(root, args, baseOpts);
  } catch (error) {
    const stderr = String(error?.stderr ?? "");
    if (DUBIOUS_OWNERSHIP.test(stderr) || DUBIOUS_OWNERSHIP.test(String(error?.message ?? ""))) {
      const safeDir = resolve(root);
      try {
        return spawnIntegrationGit(root, ["-c", `safe.directory=${safeDir}`, ...args], baseOpts);
      } catch (retryError) {
        throw new Error(formatGitCommandFailure(args, retryError));
      }
    }
    throw new Error(formatGitCommandFailure(args, error));
  }
}

export function assertAllowlistCommittedAtHead(repoRoot) {
  for (const rel of RUNNER_SOURCE_ALLOWLIST) {
    try {
      runIntegrationGit(repoRoot, ["cat-file", "-e", `HEAD:${rel}`]);
    } catch {
      throw new Error(`integration_git_allowlist_missing_at_head:${rel}`);
    }
    const dirty = String(runIntegrationGit(repoRoot, ["diff", "--name-only", "HEAD", "--", rel])).trim();
    const staged = String(
      runIntegrationGit(repoRoot, ["diff", "--name-only", "--cached", "--", rel]),
    ).trim();
    if (dirty || staged) {
      throw new Error(`integration_git_allowlist_dirty:${rel}`);
    }
  }
}

export function assertIntegrationHarnessAtHead(repoRoot) {
  for (const rel of INTEGRATION_REPOSITORY_MARKERS) {
    try {
      runIntegrationGit(repoRoot, ["cat-file", "-e", `HEAD:${rel}`]);
    } catch {
      throw new Error(`integration_git_harness_missing_at_head:${rel}`);
    }
    const dirty = String(runIntegrationGit(repoRoot, ["diff", "--name-only", "HEAD", "--", rel])).trim();
    const staged = String(
      runIntegrationGit(repoRoot, ["diff", "--name-only", "--cached", "--", rel]),
    ).trim();
    if (dirty || staged) {
      throw new Error(`integration_git_harness_dirty:${rel}`);
    }
  }
}

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

export function assertGitPreflight(repoRoot) {
  const root = resolveIntegrationRepoRoot(repoRoot);
  if (!validateIntegrationRepositoryRoot(root)) {
    throw new Error("integration_repository_root_invalid");
  }

  let top;
  try {
    top = String(runIntegrationGit(root, ["rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    if (String(error?.message ?? error).includes("integration_git_command_failed")) {
      throw error;
    }
    throw new Error("integration_git_not_a_repository");
  }

  if (normalizeRepoPath(top) !== normalizeRepoPath(root)) {
    throw new Error("integration_git_root_mismatch");
  }

  const branch = String(runIntegrationGit(root, ["branch", "--show-current"])).trim();
  if (branch && branch !== EXPECTED_BRANCH) {
    throw new Error("integration_git_branch_mismatch");
  }

  const head = String(runIntegrationGit(root, ["rev-parse", "HEAD"])).trim();
  if (!COMMIT_SHA.test(head)) {
    throw new Error("integration_git_head_invalid");
  }
  const objectType = String(runIntegrationGit(root, ["cat-file", "-t", head])).trim();
  if (objectType !== "commit") {
    throw new Error("integration_git_head_not_commit");
  }

  assertIntegrationHarnessAtHead(root);
  assertAllowlistCommittedAtHead(root);

  return { repoRoot: top, branch: branch || null, head, detached: !branch };
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
  INTEGRATION_H3_SCHEMA_ONLY_ENV,
  INTEGRATION_H3_SCHEMA_ONLY_VALUE,
  isIntegrationH3SchemaOnlyMode,
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
