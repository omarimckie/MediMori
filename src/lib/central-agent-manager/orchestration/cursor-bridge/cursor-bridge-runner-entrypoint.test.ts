import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";
import { centralAgentManagerDispatchRecoveryResponse } from "../../dispatch-recovery-handler";
import { claimNextAssignmentForAgentSync } from "../agent-consumer-operations";
import { requireDispatchRecoverySync } from "../cursor-dispatch-intent";
import { resetAgentBearerCacheForTests } from "../agent-consumer-auth";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { resetOrchestrationQueueFactoryForTests } from "../queue-store-factory";
import { createTestAgent, NOW } from "../test-fixtures";
import { createCursorBridgeHarness } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { loadBudgetStateFromFile, saveBudgetStateToFile } from "./cursor-bridge-runner-budget-file";
import {
  assertCursorBridgeRunnerPrerequisites,
  createCursorBridgeRunnerTransport,
  isRunnerOfflineFakeTransportEnabled,
  runCursorBridgeRunnerProcess,
} from "./cursor-bridge-runner-runtime";
import { sanitizeRunnerHealthForLog } from "./cursor-bridge-runner-health";
import { runCursorBridgeRunner } from "./cursor-bridge-runner";
import {
  assertCursorBridgeRunnerMayStart,
  loadCursorBridgeRunnerConfigFromEnv,
} from "./cursor-bridge-runner-config";
import type { CursorBridgeRunnerConfig } from "./cursor-bridge-runner-config";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";
import { CURSOR_BRIDGE_TEST_POLLING, describeCursorBridgeTests } from "./cursor-bridge-test-harness";
import { detachRunnerSignalHandlers } from "./cursor-bridge-runner";

const TOKEN = "cursor-bridge-token-12345678";
const BRIDGE_AGENT = "cursor-bridge-agent";
const OWNER = "bridge-owner-alpha01";
const RECOVERY_OWNER = "owner-alpha";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

const FAST_POLLING = CURSOR_BRIDGE_TEST_POLLING;
const PROJECT_TARGETS_JSON = JSON.stringify(BASE_CONFIG.projectTargets);

describeCursorBridgeTests(
  "cursor-bridge-runner-entrypoint",
  () => {
afterEach(() => {
  detachRunnerSignalHandlers();
});

function baseRunnerEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  return {
    CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED: "true",
    CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED: "true",
    CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED: "true",
    CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED: "true",
    CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT: "true",
    CURSOR_BRIDGE_RUNNER_ID: "runner-entry-test",
    CURSOR_BRIDGE_SPECIALIST_AGENT_ID: BRIDGE_AGENT,
    CURSOR_BRIDGE_PROJECT_TARGETS_JSON: PROJECT_TARGETS_JSON,
    CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON: JSON.stringify([{ agentId: BRIDGE_AGENT, token: TOKEN }]),
    ...overrides,
  };
}

function runnerStatePaths(dir: string): Pick<
  CursorBridgeRunnerConfig,
  "lockFilePath" | "budgetStateFilePath" | "emergencyStopFilePath"
> {
  return {
    lockFilePath: join(dir, "runner.lock.json"),
    budgetStateFilePath: join(dir, "budget.json"),
    emergencyStopFilePath: join(dir, "emergency-stop"),
  };
}

function runnerConfig(
  overrides: Partial<CursorBridgeRunnerConfig> = {},
  stateDir?: string,
): CursorBridgeRunnerConfig {
  const isolated = stateDir ? runnerStatePaths(stateDir) : null;
  return {
    enabled: true,
    runnerId: "runner-entry-test",
    lockFilePath: overrides.lockFilePath ?? isolated?.lockFilePath ?? join(tmpdir(), "cam-runner-missing-lock"),
    emergencyStopFilePath:
      overrides.emergencyStopFilePath ?? isolated?.emergencyStopFilePath ?? join(tmpdir(), "cam-runner-missing-stop"),
    budgetStateFilePath:
      overrides.budgetStateFilePath ?? isolated?.budgetStateFilePath ?? join(tmpdir(), "cam-runner-missing-budget"),
    idleBackoffMinMs: 1,
    idleBackoffMaxMs: 4,
    dailyCreateBudget: 5,
    hourlyCycleLimit: 20,
    bridgeConfig: BASE_CONFIG,
    dispatchOwnerId: OWNER,
    ...overrides,
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cam-runner-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("disabled runner configuration fails closed at startup", () => {
  resetAgentBearerCacheForTests();
  const env = baseRunnerEnv({ CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED: "false" });
  const config = loadCursorBridgeRunnerConfigFromEnv(env as NodeJS.ProcessEnv);
  assert.throws(() => assertCursorBridgeRunnerMayStart(config), /disabled/i);
  resetAgentBearerCacheForTests();
});

test("prerequisites reject missing bearer credentials", () => {
  resetAgentBearerCacheForTests();
  const env = baseRunnerEnv({ CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON: undefined });
  assert.throws(() => assertCursorBridgeRunnerPrerequisites(env), /bearer credentials/i);
  resetAgentBearerCacheForTests();
});

test("offline fake transport never uses REST factory", () => {
  const env = baseRunnerEnv();
  assert.equal(isRunnerOfflineFakeTransportEnabled(env), true);
  const transport = createCursorBridgeRunnerTransport(env);
  assert.ok(transport instanceof FakeCursorCloudApiTransport);
});

test("prerequisites reject live mode without consumer base URL and API key", () => {
  resetAgentBearerCacheForTests();
  const env = baseRunnerEnv({
    CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT: "false",
    CURSOR_BRIDGE_CONSUMER_BASE_URL: undefined,
    CURSOR_API_KEY: undefined,
  });
  assert.throws(() => assertCursorBridgeRunnerPrerequisites(env), /CURSOR_BRIDGE_CONSUMER_BASE_URL/);
  resetAgentBearerCacheForTests();
});

test("offline fake runner process completes one cycle (in-process consumer)", async () => {
  await withTempDir(async (dir) => {
    resetOrchestrationQueueFactoryForTests();
    resetAgentBearerCacheForTests();
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-entry-offline",
      projectId: "medimori",
      goalId: "goal",
      description: "entrypoint offline",
      requiredCapabilities: ["prepare_plan"],
      provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
      now: NOW,
    });
    store.refreshDependencyReadinessSync(NOW);
    assert.equal(store.getJobSync("job-entry-offline")?.state, "ready");
    const env = baseRunnerEnv();
    const { client } = createCursorBridgeHarness({
      store,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const result = await runCursorBridgeRunnerProcess(env, {
      config: runnerConfig({}, dir),
      transport: new FakeCursorCloudApiTransport(),
      backend: { memory: store, queue: store },
      runnerDeps: {
        consumer: client,
        now: () => NOW,
        polling: FAST_POLLING,
        sleep: async () => {},
        maxCycles: 2,
        lockStore: new FileCursorBridgeRunnerLockStore(),
        onHealth: () => {},
      },
    });
    assert.ok(result.cyclesCompleted >= 1);
    assert.equal(store.getJobSync("job-entry-offline")?.state, "completed");
    resetOrchestrationQueueFactoryForTests();
    resetAgentBearerCacheForTests();
  });
});

test("budget counters persist across runner restarts via budget file", async () => {
  await withTempDir(async (dir) => {
    const budgetPath = join(dir, "budget.json");
    await saveBudgetStateToFile(budgetPath, {
      dayKey: NOW.slice(0, 10),
      createsToday: 1,
      hourKey: NOW.slice(0, 13),
      cyclesThisHour: 2,
    });
    const loaded = await loadBudgetStateFromFile(budgetPath, new Date(NOW));
    assert.equal(loaded.createsToday, 1);
    assert.equal(loaded.cyclesThisHour, 2);
    const store = new MemoryOrchestrationQueueStore();
    const { client } = createCursorBridgeHarness({
      store,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const after = await runCursorBridgeRunner({
      config: runnerConfig({ budgetStateFilePath: budgetPath, dailyCreateBudget: 5 }, dir),
      transport: new FakeCursorCloudApiTransport(),
      store,
      consumer: client,
      bearerToken: TOKEN,
      now: () => NOW,
      maxCycles: 0,
      sleep: async () => {},
      loadBudgetState: () => loadBudgetStateFromFile(budgetPath, new Date(NOW)),
      saveBudgetState: (state) => saveBudgetStateToFile(budgetPath, state),
    });
    const persisted = await loadBudgetStateFromFile(budgetPath, new Date(NOW));
    assert.equal(persisted.createsToday, after.health.budget.createsToday);
    assert.ok(persisted.createsToday >= 1);
  });
});

test("stale singleton lock file blocks runner until operator release", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "runner.lock.json");
    const store = new FileCursorBridgeRunnerLockStore();
    await store.tryAcquire(lockPath, {
      runnerId: "stale-runner-00000001",
      pid: 4242,
      acquiredAt: NOW,
    });
    const memory = new MemoryOrchestrationQueueStore();
    const { client } = createCursorBridgeHarness({
      store: memory,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const result = await runCursorBridgeRunner({
      config: runnerConfig({ lockFilePath: lockPath }, dir),
      transport: new FakeCursorCloudApiTransport(),
      store: memory,
      consumer: client,
      bearerToken: TOKEN,
      now: () => NOW,
      lockStore: store,
      maxCycles: 1,
      sleep: async () => {},
    });
    assert.equal(result.stopReason, "lock_lost");
    assert.equal(result.health.lastErrorCode, "lock_contested");
  });
});

test("corrupt budget file blocks external create on production load path", async () => {
  await withTempDir(async (dir) => {
    const budgetPath = join(dir, "budget.json");
    await writeFile(budgetPath, "{not-json", "utf8");
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-corrupt-budget",
      projectId: "medimori",
      goalId: "goal",
      description: "corrupt budget",
      requiredCapabilities: ["prepare_plan"],
      provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
      now: NOW,
    });
    store.refreshDependencyReadinessSync(NOW);
    const { client } = createCursorBridgeHarness({
      store,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const transport = new FakeCursorCloudApiTransport();
    const env = baseRunnerEnv();
    const result = await runCursorBridgeRunnerProcess(env, {
      config: runnerConfig({}, dir),
      transport,
      backend: { memory: store, queue: store },
      runnerDeps: {
        consumer: client,
        now: () => NOW,
        polling: FAST_POLLING,
        sleep: async () => {},
        maxCycles: 2,
        lockStore: new FileCursorBridgeRunnerLockStore(),
        onHealth: () => {},
      },
    });
    assert.equal(transport.createCallCount, 0);
    assert.equal(result.health.lastErrorCode, "budget_file_unreadable");
    assert.ok(result.cyclesCompleted >= 1);
  });
});

test("budget reservation write failure prevents external create", async () => {
  await withTempDir(async (dir) => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: "job-budget-save-fail",
    projectId: "medimori",
    goalId: "goal",
    description: "budget save fail",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  store.refreshDependencyReadinessSync(NOW);
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  let createCalls = 0;
  let reserveAttempts = 0;
  const originalCreate = transport.createAgentWithInitialRun.bind(transport);
  transport.createAgentWithInitialRun = async (request) => {
    createCalls += 1;
    return originalCreate(request);
  };
  await runCursorBridgeRunner({
    config: runnerConfig({ dailyCreateBudget: 5 }, dir),
    transport,
    store,
    consumer: client,
    bearerToken: TOKEN,
    bridgeEnabled: () => true,
    now: () => NOW,
    polling: FAST_POLLING,
    maxCycles: 1,
    sleep: async () => {},
    saveBudgetState: async () => {
      reserveAttempts += 1;
      if (reserveAttempts === 1) {
        throw new Error("disk_full");
      }
    },
  });
  assert.equal(createCalls, 0);
  assert.ok(reserveAttempts >= 1);
  });
});

test("file lock release ignores foreign runner id", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "runner.lock.json");
    const store = new FileCursorBridgeRunnerLockStore();
    assert.equal(
      await store.tryAcquire(lockPath, { runnerId: "owner-runner", pid: 1, acquiredAt: NOW }),
      true,
    );
    await store.release(lockPath, "foreign-runner");
    assert.ok(await store.read(lockPath));
    await store.release(lockPath, "owner-runner");
    assert.equal(await store.read(lockPath), null);
  });
});

test("file lock probe reports contention across independent processes", async () => {
  await withTempDir(async (dir) => {
    const lockPath = join(dir, "runner.lock.json");
    const probe = join(process.cwd(), "scripts", "cursor-bridge-runner-lock-probe.ts");
    const spawnProbe = (args: string[]) =>
      spawnSync("npx", ["tsx", probe, ...args], {
        encoding: "utf8",
        cwd: process.cwd(),
        shell: process.platform === "win32",
      });
    const first = spawnProbe(["acquire", lockPath, "probe-a"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /acquired/);
    const second = spawnProbe(["acquire", lockPath, "probe-b"]);
    assert.equal(second.status, 1);
    assert.match(second.stdout, /contested/);
    const release = spawnProbe(["release", lockPath, "probe-a"]);
    assert.equal(release.status, 0);
  });
});

test("runner aborts active polling when shutdown is requested", async () => {
  await withTempDir(async (dir) => {
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-abort-poll",
      projectId: "medimori",
      goalId: "goal",
      description: "abort poll",
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
    transport.configurePollsBeforeFinished(20);
    let polls = 0;
    let abort = false;
    const result = await runCursorBridgeRunner({
      config: runnerConfig({}, dir),
      transport,
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      polling: { pollIntervalMs: 5, pollMaxDurationMs: 5_000, heartbeatMinIntervalMs: 0 },
      sleep: async (ms) => {
        polls += 1;
        if (polls >= 2) abort = true;
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
      maxCycles: 1,
      shouldAbort: () => abort,
    });
    assert.match(result.health.lastErrorCode ?? "", /polling aborted/i);
  });
});

test("emergency stop file aborts polling mid-cycle", async () => {
  await withTempDir(async (dir) => {
    const stopPath = join(dir, "emergency-stop");
    const store = new MemoryOrchestrationQueueStore();
    store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await store.enqueueJob({
      id: "job-emergency-stop",
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
    const transport = new FakeCursorCloudApiTransport();
    transport.configurePollsBeforeFinished(20);
    let polls = 0;
    const result = await runCursorBridgeRunner({
      config: runnerConfig({ emergencyStopFilePath: stopPath }, dir),
      transport,
      store,
      consumer: client,
      bearerToken: TOKEN,
      bridgeEnabled: () => true,
      now: () => NOW,
      polling: { pollIntervalMs: 5, pollMaxDurationMs: 5_000, heartbeatMinIntervalMs: 0 },
      sleep: async (ms) => {
        polls += 1;
        if (polls === 1) {
          await writeFile(stopPath, "stop", "utf8");
        }
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
      maxCycles: 1,
      emergencyStopFilePath: stopPath,
    });
    assert.match(result.health.lastErrorCode ?? "", /polling aborted/i);
  });
});

test("confirmed external ids resume without second create", async () => {
  await withTempDir(async (dir) => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: "job-entry-confirm",
    projectId: "medimori",
    goalId: "goal",
    description: "confirm resume",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  store.refreshDependencyReadinessSync(NOW);
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const claimed = claimNextAssignmentForAgentSync(store, BRIDGE_AGENT, NOW);
  assert.ok(claimed);
  requireDispatchRecoverySync(
    store,
    BRIDGE_AGENT,
    claimed.id,
    claimed.lease.fenceToken,
    NOW,
    "Ambiguous create for entrypoint test.",
  );
  const transport = new FakeCursorCloudApiTransport();
  transport.runs.set("bc-entry-00000001:run-entry-00000001", {
    request: { promptText: "x", repoUrl: "https://github.com/example/medimori" },
    status: "FINISHED",
    artifactPath: "artifacts/cursor-bridge/outcome.json",
  });
  await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "confirm_verified_external_ids",
        assignmentId: claimed.id,
        auditId: "audit-entry-confirm",
        externalRefs: {
          cursorAgentId: "bc-entry-00000001",
          cursorRunId: "run-entry-00000001",
        },
      }),
    }),
    {
      isEnabled: () => true,
      isOwnerConfigured: () => true,
      recoveryEnabled: () => true,
      isOwner: (u) => u === RECOVERY_OWNER,
      getUsername: async () => RECOVERY_OWNER,
      resolveStore: async () => store,
      now: () => NOW,
    },
  );
  const result = await runCursorBridgeRunner({
    config: runnerConfig({ dailyCreateBudget: 5 }, dir),
    transport,
    store,
    consumer: client,
    bearerToken: TOKEN,
    bridgeEnabled: () => true,
    now: () => NOW,
    polling: FAST_POLLING,
    sleep: async () => {},
    maxCycles: 2,
  });
  assert.equal(transport.createCallCount, 0);
  assert.ok(result.cyclesCompleted >= 1);
  assert.equal(store.getJobSync("job-entry-confirm")?.state, "completed");
  });
});

test("ambiguous create requires owner recovery before bridge creates", async () => {
  await withTempDir(async (dir) => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: "job-entry-ambiguous",
    projectId: "medimori",
    goalId: "goal",
    description: "ambiguous",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  store.refreshDependencyReadinessSync(NOW);
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const claimed = claimNextAssignmentForAgentSync(store, BRIDGE_AGENT, NOW);
  assert.ok(claimed);
  requireDispatchRecoverySync(
    store,
    BRIDGE_AGENT,
    claimed.id,
    claimed.lease.fenceToken,
    NOW,
    "Ambiguous network response.",
  );
  const transport = new FakeCursorCloudApiTransport();
  const result = await runCursorBridgeRunner({
    config: runnerConfig({ dailyCreateBudget: 5 }, dir),
    transport,
    store,
    consumer: client,
    bearerToken: TOKEN,
    bridgeEnabled: () => true,
    now: () => NOW,
    polling: FAST_POLLING,
    sleep: async () => {},
    maxCycles: 2,
  });
  assert.equal(transport.createCallCount, 0);
  assert.equal(store.getJobSync("job-entry-ambiguous")?.state, "blocked");
  assert.ok(result.cyclesCompleted >= 1);
  });
});

test("health log serialization excludes credential-like material", () => {
  const line = sanitizeRunnerHealthForLog({
    contractVersion: "central-agent-manager-cursor-bridge-runner-health/v1",
    runnerId: "runner-entry-test",
    status: "idle",
    emergencyStop: false,
    lockHeld: true,
    lockOwner: "runner-entry-test",
    activeAssignmentId: null,
    budget: { createsToday: 0, cyclesThisHour: 0 },
    lastCycleAt: NOW,
    lastErrorCode: "lock_contested",
  });
  assert.doesNotMatch(line, new RegExp(TOKEN));
  assert.doesNotMatch(line, /CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON/);
});
  },
  60_000,
);
