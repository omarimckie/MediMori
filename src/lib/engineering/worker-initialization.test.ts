import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diagnoseWorkerInitialization,
  parseWorkerInitializationConfig,
  sanitizedInitializationDiagnostic,
  WorkerInitializationError,
  workerInitializationCodes,
  workerInitializationLimits,
} from "./worker-initialization";
import { checkedScratchCapacity } from "./workspace";

function validEnvironment(root: string): Record<string, string> {
  return {
    ENGINEERING_WORKER_ENABLED: "true",
    ENGINEERING_WORKER_DATABASE_URL: ["postgresql://", "medimori_engineering_2c_worker:fake-password@", "ep-gentle-dawn-au6vxirn-pooler.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require"].join(""),
    ENGINEERING_WORKSPACE_EXPORT: join(root, "scratch", "exports"),
    ENGINEERING_SCRATCH_ROOT: join(root, "scratch"),
    ENGINEERING_WORKSPACE_SOURCE: join(root, "source"),
    ENGINEERING_SANDBOX_IMAGE: `registry.example/engineering@sha256:${"a".repeat(64)}`,
    ENGINEERING_NODE_MODULES_VOLUME: "medimori-engineering-node-modules",
    OPENAI_API_KEY: "fake-provider-key",
  };
}

test("worker initialization config accepts a structurally valid disposable setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "engineering-init-valid-"));
  try {
    const env = validEnvironment(root);
    const config = parseWorkerInitializationConfig(env, "b61b0dc7-d1ab-45ea-88c0-6480cda5029a");
    assert.equal(config.dependencyVolume, "medimori-engineering-node-modules");
    assert.equal(config.runId, "b61b0dc7-d1ab-45ea-88c0-6480cda5029a");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("initialization config classifies missing, disabled, malformed URL, wrong role, and invalid image", async () => {
  const root = await mkdtemp(join(tmpdir(), "engineering-init-errors-"));
  try {
    const base = validEnvironment(root);
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...base, ENGINEERING_WORKER_ENABLED: "false" }, "worker_disabled"],
      [Object.fromEntries(Object.entries(base).filter(([key]) => key !== "ENGINEERING_WORKER_DATABASE_URL")), "worker_database_config_missing"],
      [Object.fromEntries(Object.entries(base).filter(([key]) => key !== "OPENAI_API_KEY")), "required_configuration_missing"],
      [{ ...base, ENGINEERING_WORKER_DATABASE_URL: "not-a-url" }, "worker_database_config_invalid"],
      [{ ...base, ENGINEERING_WORKER_DATABASE_URL: base.ENGINEERING_WORKER_DATABASE_URL.replace("medimori_engineering_2c_worker", "admin") }, "worker_database_role_mismatch"],
      [{ ...base, ENGINEERING_WORKER_DATABASE_URL: base.ENGINEERING_WORKER_DATABASE_URL.replace("neondb", "production") }, "worker_database_branch_mismatch"],
      [{ ...base, ENGINEERING_SANDBOX_IMAGE: "latest" }, "invalid_sandbox_image"],
    ];
    for (const [env, expected] of cases) {
      assert.throws(() => parseWorkerInitializationConfig(env), error => error instanceof WorkerInitializationError && error.code === expected);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("offline diagnostic passes real config and read-only scratch preflight without external side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "engineering-init-offline-"));
  try {
    const source = join(root, "source");
    const scratch = join(root, "scratch");
    const exports = join(scratch, "exports");
    await Promise.all([mkdir(source), mkdir(exports, { recursive: true })]);
    const result = await diagnoseWorkerInitialization(validEnvironment(root), { minimumScratchFreeBytes: BigInt(0) });
    assert.equal(result.ready, true);
    if (result.ready && "scratch" in result) {
      assert.equal(result.providerCouldHaveBeenReached, false);
      assert.equal(result.dockerCouldHaveBeenReached, false);
      assert.equal(result.scratch?.perFileSizeGuard, "passed");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scratch capacity rule deterministically accepts sufficient and rejects insufficient space", () => {
  const gib = BigInt(1024) * BigInt(1024) * BigInt(1024);
  const sourceBytes = BigInt(17);
  const defaultMinimum = BigInt(10) * gib;
  const requiredBytes = sourceBytes * BigInt(2) + defaultMinimum;
  assert.deepEqual(checkedScratchCapacity(requiredBytes, sourceBytes), {
    availableBytes: requiredBytes,
    requiredBytes,
    sourceBytes,
  });
  assert.throws(() => checkedScratchCapacity(requiredBytes - BigInt(1), sourceBytes), error =>
    error instanceof Error && error.message === "Configured engineering scratch has insufficient free space.");
});

test("offline diagnostic safely classifies an inaccessible scratch path", async () => {
  const root = await mkdtemp(join(tmpdir(), "engineering-init-missing-"));
  try {
    const result = await diagnoseWorkerInitialization(validEnvironment(root));
    assert.equal(result.ready, false);
    if (!result.ready) {
      assert.equal(result.stage, "scratch_preflight");
      assert.equal(result.code, "scratch_path_missing");
      assert.equal(result.providerCouldHaveBeenReached, false);
      assert.equal(result.dockerCouldHaveBeenReached, false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("diagnostics use allow-listed summaries and never include arbitrary exception data", () => {
  const secret = ["postgresql://", "private-user:private-password@host/private-db", " sk-private-key"].join("");
  const diagnostic = sanitizedInitializationDiagnostic(new Error(secret));
  assert.equal(diagnostic.code, "unexpected_setup_failure");
  assert.equal(diagnostic.summary.includes(secret), false);
  assert.equal(JSON.stringify(diagnostic).includes("private-password"), false);
  assert.equal(JSON.stringify(diagnostic).includes("sk-private-key"), false);
  assert.equal(workerInitializationLimits.providerCalledOffline, false);
  assert.ok(workerInitializationCodes.includes("source_export_failed"));
});
