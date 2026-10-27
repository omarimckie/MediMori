import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createTestAgent, NOW } from "../test-fixtures";
import { createCursorBridgeHarness, runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { detachRunnerSignalHandlers, runCursorBridgeRunner } from "./cursor-bridge-runner";
import { CURSOR_BRIDGE_TEST_POLLING, describeCursorBridgeTests } from "./cursor-bridge-test-harness";
import type { CursorBridgeRunnerConfig } from "./cursor-bridge-runner-config";
import { InMemoryCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-singleton";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

const TOKEN = "cursor-bridge-token-12345678";
const BRIDGE_AGENT = "cursor-bridge-agent";
const OWNER = "bridge-owner-alpha01";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

describeCursorBridgeTests("cursor-bridge-runner", () => {
afterEach(() => {
  detachRunnerSignalHandlers();
});

function runnerPollingDeps() {
  return { polling: CURSOR_BRIDGE_TEST_POLLING };
}

function runnerConfig(overrides: Partial<CursorBridgeRunnerConfig> = {}): CursorBridgeRunnerConfig {
  return {
    enabled: true,
    runnerId: "runner-alpha-test",
    lockFilePath: "lock-alpha",
    emergencyStopFilePath: "stop-alpha",
    budgetStateFilePath: "budget-alpha",
    idleBackoffMinMs: 1,
    idleBackoffMaxMs: 4,
    dailyCreateBudget: 2,
    hourlyCycleLimit: 10,
    bridgeConfig: BASE_CONFIG,
    dispatchOwnerId: OWNER,
    ...overrides,
  };
}

async function seedJob(store: MemoryOrchestrationQueueStore, jobId: string) {
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal",
    description: "runner test job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  store.refreshDependencyReadinessSync(NOW);
}

test("runner rejects startup when disabled", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  await assert.rejects(
    () =>
      runCursorBridgeRunner({
        config: runnerConfig({ enabled: false }),
        transport: new FakeCursorCloudApiTransport(),
        store,
        consumer: client,
        bearerToken: TOKEN,
        now: () => NOW,
        maxCycles: 1,
      }),
    /disabled/i,
  );
});

test("runner enforces singleton lock across competing runner ids", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const lockStore = new InMemoryCursorBridgeRunnerLockStore();
  const harness = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  const first = await runCursorBridgeRunner({
    config: runnerConfig({ runnerId: "runner-one-00000001", lockFilePath: "shared-lock" }),
    transport,
    store,
    consumer: harness.client,
    bearerToken: TOKEN,
    now: () => NOW,
    lockStore,
    maxCycles: 0,
    sleep: async () => {},
  });
  assert.equal(first.stopReason, "completed");
  const foreignHeld = await lockStore.tryAcquire("shared-lock", {
    runnerId: "runner-two-00000002",
    pid: 99,
    acquiredAt: NOW,
  });
  assert.equal(foreignHeld, true);
  const second = await runCursorBridgeRunner({
    config: runnerConfig({ runnerId: "runner-one-00000001", lockFilePath: "shared-lock" }),
    transport,
    store,
    consumer: harness.client,
    bearerToken: TOKEN,
    now: () => NOW,
    lockStore,
    maxCycles: 1,
    sleep: async () => {},
  });
  assert.equal(second.stopReason, "lock_lost");
});

test("runner honors emergency stop before cycles", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const result = await runCursorBridgeRunner({
    config: runnerConfig(),
    transport: new FakeCursorCloudApiTransport(),
    store,
    consumer: client,
    bearerToken: TOKEN,
    now: () => NOW,
    emergencyStopActive: async () => true,
    maxCycles: 3,
    sleep: async () => {},
  });
  assert.equal(result.stopReason, "emergency_stop");
  assert.equal(result.cyclesCompleted, 0);
});

test("runner completes one assignment cycle with fake transport", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-runner-cycle");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  const result = await runCursorBridgeRunner({
    config: runnerConfig({ dailyCreateBudget: 5, hourlyCycleLimit: 5 }),
    transport,
    store,
    consumer: client,
    bearerToken: TOKEN,
    bridgeEnabled: () => true,
    now: () => NOW,
    ...runnerPollingDeps(),
    maxCycles: 2,
    sleep: async () => {},
  });
  assert.ok(result.cyclesCompleted >= 1);
  assert.equal(store.getJobSync("job-runner-cycle")?.state, "completed");
});

test("runner reserves create budget before external create and blocks restart over-allocation", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-reserve-a");
  await seedJob(store, "job-reserve-b");
  store.refreshDependencyReadinessSync(NOW);
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  const budgetPath = "budget-reserve-test";
  let persistedCreates = 0;
  const result = await runCursorBridgeRunner({
    config: runnerConfig({ dailyCreateBudget: 1, hourlyCycleLimit: 10, budgetStateFilePath: budgetPath }),
    transport,
    store,
    consumer: client,
    bearerToken: TOKEN,
    bridgeEnabled: () => true,
    now: () => NOW,
    ...runnerPollingDeps(),
    maxCycles: 4,
    sleep: async () => {},
    loadBudgetState: async () => ({
      dayKey: NOW.slice(0, 10),
      createsToday: persistedCreates,
      hourKey: NOW.slice(0, 13),
      cyclesThisHour: 0,
    }),
    saveBudgetState: async (state) => {
      persistedCreates = state.createsToday;
    },
  });
  assert.equal(persistedCreates, 1);
  assert.ok(result.health.lastErrorCode === "daily_create_budget" || result.cyclesCompleted >= 2);
});

test("runner stops when daily create budget is exhausted", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-budget-a");
  await seedJob(store, "job-budget-b");
  await seedJob(store, "job-budget-c");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  let budget = { dayKey: NOW.slice(0, 10), createsToday: 1, hourKey: NOW.slice(0, 13), cyclesThisHour: 0 };
  const result = await runCursorBridgeRunner({
    config: runnerConfig({ dailyCreateBudget: 1, hourlyCycleLimit: 20 }),
    transport,
    store,
    consumer: client,
    bearerToken: TOKEN,
    bridgeEnabled: () => true,
    now: () => NOW,
    ...runnerPollingDeps(),
    maxCycles: 5,
    sleep: async () => {},
    loadBudgetState: async () => budget,
    saveBudgetState: async (state) => {
      budget = state;
    },
  });
  assert.ok(result.health.budget.createsToday <= 1);
});

test("runner processes at most one assignment per cycle", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-single-active");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  const result = await runCursorBridgeAssignmentCycle({
    bridgeEnabled: () => true,
    transport,
    config: BASE_CONFIG,
    store,
    consumer: client,
    dispatchOwnerId: OWNER,
    ...runnerPollingDeps(),
    sleep: async () => {},
    now: () => NOW,
    bearerToken: TOKEN,
  });
  assert.ok(result);
  assert.equal(store.listAssignmentsSync().filter((row) => row.state === "active").length, 0);
});
});
