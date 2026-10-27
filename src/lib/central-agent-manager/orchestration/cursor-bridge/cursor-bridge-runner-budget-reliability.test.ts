import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestAgent, NOW } from "../test-fixtures";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createCursorBridgeHarness } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";
import {
  budgetAllowsCycle,
  createEmptyBudgetState,
  normalizeBudgetState,
  reserveDailyCreateSlot,
} from "./cursor-bridge-runner-budget";
import {
  CursorBridgeRunnerBudgetFileError,
  loadBudgetStateFromFile,
  saveBudgetStateToFile,
} from "./cursor-bridge-runner-budget-file";
import { runCursorBridgeRunner } from "./cursor-bridge-runner";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";

const LIMITS = { dailyCreateBudget: 2, hourlyCycleLimit: 3 };

test("missing budget normalizes to zero and allows first reservation", () => {
  const state = normalizeBudgetState(null, new Date(NOW));
  assert.equal(state.createsToday, 0);
  const reserved = reserveDailyCreateSlot(state, LIMITS, new Date(NOW));
  assert.equal(reserved.createsToday, 1);
});

test("invalid budget config blocks cycles fail-closed", () => {
  const state = createEmptyBudgetState(new Date(NOW));
  const allowance = budgetAllowsCycle(state, { dailyCreateBudget: 0, hourlyCycleLimit: 0 }, true);
  assert.equal(allowance.allowed, false);
});

test("exhausted daily budget blocks further reservations", () => {
  let state = normalizeBudgetState(null, new Date(NOW));
  state = reserveDailyCreateSlot(state, LIMITS, new Date(NOW));
  state = reserveDailyCreateSlot(state, LIMITS, new Date(NOW));
  assert.throws(() => reserveDailyCreateSlot(state, LIMITS, new Date(NOW)), /daily_create_budget/);
});

test("restart runner reloads persisted budget consumption from file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-restart-"));
  const budgetPath = join(dir, "budget.json");
  const lockPath = join(dir, "runner.lock.json");
  const config = {
    enabled: true,
    runnerId: "budget-restart-runner",
    lockFilePath: lockPath,
    emergencyStopFilePath: join(dir, "stop"),
    budgetStateFilePath: budgetPath,
    idleBackoffMinMs: 1,
    idleBackoffMaxMs: 2,
    dailyCreateBudget: 5,
    hourlyCycleLimit: 10,
    bridgeConfig: validateCursorBridgeConfig({
      specialistAgentId: "budget-restart-agent",
      projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
    }),
    dispatchOwnerId: "budget-owner",
  };
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: "budget-restart-agent" }));
  const { client } = createCursorBridgeHarness({
    store,
    config: config.bridgeConfig,
    bearerToken: "budget-restart-token-123456",
    now: () => NOW,
    dispatchOwnerId: "budget-owner",
  });
  const lockStore = new FileCursorBridgeRunnerLockStore();
  try {
    await runCursorBridgeRunner({
      config,
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: "budget-restart-token-123456",
      bridgeEnabled: () => true,
      now: () => NOW,
      lockStore,
      maxCycles: 2,
      polling: { pollIntervalMs: 0, pollMaxDurationMs: 100, heartbeatMinIntervalMs: 0 },
      sleep: async () => {},
      loadBudgetState: () => loadBudgetStateFromFile(budgetPath, new Date(NOW)),
      saveBudgetState: (state) => saveBudgetStateToFile(budgetPath, state),
    });
    const after = await loadBudgetStateFromFile(budgetPath, new Date(NOW));
    assert.ok(after.cyclesThisHour >= 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent local runners: second runner fails lock and does not spend budget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-concurrent-"));
  const lockPath = join(dir, "runner.lock.json");
  const budgetPath = join(dir, "budget.json");
  const baseConfig = {
    enabled: true,
    lockFilePath: lockPath,
    emergencyStopFilePath: join(dir, "stop"),
    budgetStateFilePath: budgetPath,
    idleBackoffMinMs: 1,
    idleBackoffMaxMs: 2,
    dailyCreateBudget: 10,
    hourlyCycleLimit: 10,
    bridgeConfig: validateCursorBridgeConfig({
      specialistAgentId: "budget-concurrent-agent",
      projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
    }),
    dispatchOwnerId: "budget-owner",
  };
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: "budget-concurrent-agent" }));
  const { client } = createCursorBridgeHarness({
    store,
    config: baseConfig.bridgeConfig,
    bearerToken: "budget-concurrent-token1234",
    now: () => NOW,
  });
  const lockStore = new FileCursorBridgeRunnerLockStore();
  try {
    const acquired = await lockStore.tryAcquire(lockPath, {
      runnerId: "holder",
      pid: 42,
      acquiredAt: NOW,
    });
    assert.equal(acquired, true);
    const contested = await runCursorBridgeRunner({
      config: { ...baseConfig, runnerId: "contender" },
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: "budget-concurrent-token1234",
      bridgeEnabled: () => true,
      now: () => NOW,
      lockStore,
      maxCycles: 1,
      polling: { pollIntervalMs: 0, pollMaxDurationMs: 100, heartbeatMinIntervalMs: 0 },
      sleep: async () => {},
      loadBudgetState: () => loadBudgetStateFromFile(budgetPath, new Date(NOW)),
      saveBudgetState: (state) => saveBudgetStateToFile(budgetPath, state),
    });
    assert.equal(contested.stopReason, "lock_lost");
    const budget = await loadBudgetStateFromFile(budgetPath, new Date(NOW));
    assert.equal(budget.cyclesThisHour, 0);
    await lockStore.release(lockPath, "holder");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt budget file fails closed at load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-rel-"));
  const path = join(dir, "budget.json");
  try {
    await writeFile(path, "[]", "utf8");
    await assert.rejects(() => loadBudgetStateFromFile(path, new Date(NOW)), CursorBridgeRunnerBudgetFileError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
