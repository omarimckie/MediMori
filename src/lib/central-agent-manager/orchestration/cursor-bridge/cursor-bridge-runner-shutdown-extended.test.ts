import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

const TOKEN = "cursor-bridge-shutdown-ext-token";
const BRIDGE_AGENT = "cursor-bridge-shutdown-ext";
const OWNER = "bridge-shutdown-ext-owner";

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
    runnerId: "runner-shutdown-ext",
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
  const dir = await mkdtemp(join(tmpdir(), "cam-shutdown-ext-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("SIGTERM during heartbeat polling aborts without completing job", async () => {
  await withTempDir(async (dir) => {
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-shutdown-heartbeat",
      projectId: "medimori",
      goalId: "goal",
      description: "heartbeat shutdown",
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
    transport.configurePollsBeforeFinished(30);
    let heartbeats = 0;
    const result = await runCursorBridgeRunner({
      config: runnerConfig(dir),
      transport,
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      maxCycles: 1,
      polling: { pollIntervalMs: 1, pollMaxDurationMs: 60_000, heartbeatMinIntervalMs: 0 },
      sleep: async (ms) => {
        heartbeats += 1;
        if (heartbeats >= 2) process.emit("SIGTERM");
        await new Promise((r) => setTimeout(r, ms));
      },
      loadBudgetState: async () => createEmptyBudgetState(new Date(NOW)),
      saveBudgetState: async () => {},
    });
    assert.ok(heartbeats >= 2);
    assert.equal(result.stopReason, "signal");
    assert.notEqual(store.getJobSync("job-shutdown-heartbeat")?.state, "completed");
  });
});

test("repeated SIGTERM is idempotent and releases lock once", async () => {
  let signals = 0;
  attachRunnerSignalHandlers(() => {
    signals += 1;
  });
  process.emit("SIGTERM");
  process.emit("SIGTERM");
  process.emit("SIGINT");
  detachRunnerSignalHandlers();
  assert.equal(signals, 3);
});

test("runner restart after signal can acquire lock again", async () => {
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
    const config = runnerConfig(dir);
    const first = await runCursorBridgeRunner({
      config,
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      lockStore,
      maxCycles: 2,
      polling: { pollIntervalMs: 0, pollMaxDurationMs: 100, heartbeatMinIntervalMs: 0 },
      sleep: async () => {
        process.emit("SIGTERM");
      },
      loadBudgetState: async () => createEmptyBudgetState(new Date(NOW)),
      saveBudgetState: async () => {},
    });
    assert.equal(first.stopReason, "signal");
    const second = await runCursorBridgeRunner({
      config: { ...config, runnerId: "runner-shutdown-ext-2" },
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      lockStore,
      maxCycles: 1,
      polling: { pollIntervalMs: 0, pollMaxDurationMs: 100, heartbeatMinIntervalMs: 0 },
      sleep: async () => {},
      loadBudgetState: async () => createEmptyBudgetState(new Date(NOW)),
      saveBudgetState: async () => {},
    });
    assert.notEqual(second.stopReason, "lock_lost");
    assert.equal(second.cyclesCompleted, 1);
  });
});

test("emergency stop file ends runner without completing enqueued job", async () => {
  await withTempDir(async (dir) => {
    const stopPath = join(dir, "emergency-stop");
    await writeFile(stopPath, "1", "utf8");
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-emergency-budget",
      projectId: "medimori",
      goalId: "goal",
      description: "emergency",
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
    const result = await runCursorBridgeRunner({
      config: runnerConfig(dir),
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      maxCycles: 3,
      emergencyStopFilePath: stopPath,
      polling: { pollIntervalMs: 0, pollMaxDurationMs: 100, heartbeatMinIntervalMs: 0 },
      sleep: async () => {},
      loadBudgetState: async () => createEmptyBudgetState(new Date(NOW)),
      saveBudgetState: async () => {},
    });
    assert.equal(result.stopReason, "emergency_stop");
    assert.notEqual(store.getJobSync("job-emergency-budget")?.state, "completed");
  });
});
