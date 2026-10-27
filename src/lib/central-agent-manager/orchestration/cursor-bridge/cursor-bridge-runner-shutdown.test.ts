import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestAgent, NOW } from "../test-fixtures";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createCursorBridgeHarness } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";
import { createEmptyBudgetState } from "./cursor-bridge-runner-budget";
import {
  attachRunnerSignalHandlers,
  detachRunnerSignalHandlers,
  runCursorBridgeRunner,
} from "./cursor-bridge-runner";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";
import type { CursorBridgeRunnerConfig } from "./cursor-bridge-runner-config";

const TOKEN = "cursor-bridge-shutdown-token01";
const BRIDGE_AGENT = "cursor-bridge-shutdown";
const OWNER = "bridge-shutdown-owner";

afterEach(() => {
  detachRunnerSignalHandlers();
});

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

function runnerConfig(dir: string): CursorBridgeRunnerConfig {
  return {
    enabled: true,
    runnerId: "runner-shutdown-test",
    lockFilePath: join(dir, "runner.lock.json"),
    emergencyStopFilePath: join(dir, "emergency-stop"),
    budgetStateFilePath: join(dir, "budget.json"),
    idleBackoffMinMs: 1,
    idleBackoffMaxMs: 4,
    dailyCreateBudget: 24,
    hourlyCycleLimit: 60,
    bridgeConfig: BASE_CONFIG,
    dispatchOwnerId: OWNER,
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cam-runner-shutdown-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("attachRunnerSignalHandlers invokes callback on SIGTERM", () => {
  let signaled = 0;
  attachRunnerSignalHandlers(() => {
    signaled += 1;
  });
  process.emit("SIGTERM");
  process.emit("SIGTERM");
  detachRunnerSignalHandlers();
  assert.equal(signaled, 2);
});

test("SIGTERM during idle runner stops without completing a job", async () => {
  await withTempDir(async (dir) => {
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    const { client } = createCursorBridgeHarness({
      store,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const lockStore = new FileCursorBridgeRunnerLockStore();
    const lockPath = join(dir, "runner.lock.json");
    const result = await runCursorBridgeRunner({
      config: { ...runnerConfig(dir), lockFilePath: lockPath },
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      lockStore,
      maxCycles: 5,
      polling: { pollIntervalMs: 0, pollMaxDurationMs: 100, heartbeatMinIntervalMs: 0 },
      sleep: async () => {
        process.emit("SIGTERM");
      },
      loadBudgetState: async () => createEmptyBudgetState(new Date(NOW)),
      saveBudgetState: async () => {},
    });
    assert.equal(result.stopReason, "signal");
    assert.equal(store.listJobsSync().length, 0);
    assert.equal(await lockStore.read(lockPath), null);
  });
});

test("SIGTERM during active fake polling aborts without marking job completed", async () => {
  await withTempDir(async (dir) => {
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-shutdown-active",
      projectId: "medimori",
      goalId: "goal",
      description: "active shutdown",
      requiredCapabilities: ["prepare_plan"],
      provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
      now: NOW,
    });
    const { client } = createCursorBridgeHarness({
      store,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const transport = new FakeCursorCloudApiTransport();
    transport.configurePollsBeforeFinished(50);
    let polls = 0;
    const result = await runCursorBridgeRunner({
      config: runnerConfig(dir),
      transport,
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      maxCycles: 1,
      polling: { pollIntervalMs: 5, pollMaxDurationMs: 5_000, heartbeatMinIntervalMs: 0 },
      sleep: async (ms) => {
        polls += 1;
        if (polls === 2) process.emit("SIGTERM");
        await new Promise((r) => setTimeout(r, ms));
      },
      loadBudgetState: async () => createEmptyBudgetState(new Date(NOW)),
      saveBudgetState: async () => {},
    });
    assert.match(result.health.lastErrorCode ?? "", /polling aborted|shutdown/i);
    const job = store.getJobSync("job-shutdown-active");
    assert.ok(job);
    assert.notEqual(job.state, "completed");
  });
});
