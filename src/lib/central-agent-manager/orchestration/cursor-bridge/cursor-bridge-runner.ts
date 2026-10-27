import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import { runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import type { CursorBridgeConsumerPort } from "./cursor-bridge-consumer-port";
import type { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import {
  budgetAllowsCycle,
  createEmptyBudgetState,
  normalizeBudgetState,
  recordRunnerCycle,
  reserveDailyCreateSlot,
  type CursorBridgeRunnerBudgetState,
} from "./cursor-bridge-runner-budget";
import { BUDGET_FILE_UNREADABLE_CODE } from "./cursor-bridge-runner-budget-file";
import {
  assertCursorBridgeRunnerMayStart,
  type CursorBridgeRunnerConfig,
} from "./cursor-bridge-runner-config";
import { buildRunnerHealthSnapshot, type CursorBridgeRunnerHealthSnapshot } from "./cursor-bridge-runner-health";
import {
  InMemoryCursorBridgeRunnerLockStore,
  releaseRunnerLock,
  tryAcquireRunnerLock,
  type CursorBridgeRunnerLockStore,
} from "./cursor-bridge-runner-singleton";
import { existsSync } from "node:fs";
import type { CursorBridgePollingConfig } from "./cursor-rest-config";

export type CursorBridgeRunnerDeps = {
  config: CursorBridgeRunnerConfig;
  transport: CursorCloudApiTransport;
  store: MemoryOrchestrationQueueStore;
  /** When durable reload replaces the in-memory store, return the current instance. */
  liveStore?: () => MemoryOrchestrationQueueStore;
  consumer: CursorBridgeConsumerPort;
  reloadStore?: () => Promise<void>;
  shouldAbort?: () => boolean;
  bearerToken: string;
  bridgeEnabled?: () => boolean;
  lockStore?: CursorBridgeRunnerLockStore;
  polling?: CursorBridgePollingConfig;
  sleep?: (ms: number) => Promise<void>;
  now: () => string;
  clock?: () => Date;
  pid?: number;
  emergencyStopActive?: () => Promise<boolean>;
  loadBudgetState?: () => Promise<CursorBridgeRunnerBudgetState | null>;
  saveBudgetState?: (state: CursorBridgeRunnerBudgetState) => Promise<void>;
  onHealth?: (health: CursorBridgeRunnerHealthSnapshot) => void;
  maxCycles?: number;
  /** When set, polling aborts if this file exists (in addition to signal shutdown). */
  emergencyStopFilePath?: string;
};

export type CursorBridgeRunnerStopReason =
  | "signal"
  | "emergency_stop"
  | "max_cycles"
  | "lock_lost"
  | "disabled";

export type CursorBridgeRunnerRunResult = {
  cyclesCompleted: number;
  stopReason: CursorBridgeRunnerStopReason | "completed";
  health: CursorBridgeRunnerHealthSnapshot;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCursorBridgeRunner(deps: CursorBridgeRunnerDeps): Promise<CursorBridgeRunnerRunResult> {
  assertCursorBridgeRunnerMayStart(deps.config);
  const lockStore = deps.lockStore ?? new InMemoryCursorBridgeRunnerLockStore();
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.clock ?? (() => new Date(deps.now()));
  const pid = deps.pid ?? 0;
  const emergencyStopActive =
    deps.emergencyStopActive ?? (async () => false);
  const loadBudgetState = deps.loadBudgetState ?? (async () => null);
  const saveBudgetState = deps.saveBudgetState ?? (async () => {});

  let budgetFileHealthy = true;
  let budget: CursorBridgeRunnerBudgetState;
  try {
    budget = normalizeBudgetState(await loadBudgetState(), clock());
  } catch {
    budget = createEmptyBudgetState(clock());
    budgetFileHealthy = false;
  }
  let status: CursorBridgeRunnerHealthSnapshot["status"] = "idle";
  let activeAssignmentId: string | null = null;
  let lastCycleAt: string | null = null;
  let lastErrorCode: string | null = budgetFileHealthy ? null : BUDGET_FILE_UNREADABLE_CODE;
  let cyclesCompleted = 0;
  let idleBackoff = deps.config.idleBackoffMinMs;
  let stopReason: CursorBridgeRunnerStopReason | null = null;
  let shuttingDown = false;
  let emergencyStop = false;

  const emergencyStopFile = (): string | undefined =>
    deps.emergencyStopFilePath ?? deps.config.emergencyStopFilePath;

  const emergencyStopFilePresent = (): boolean => {
    const path = emergencyStopFile();
    return Boolean(path && existsSync(path));
  };

  const shouldAbortCycle = (): boolean => {
    if (shuttingDown || emergencyStop) return true;
    if (emergencyStopFilePresent()) return true;
    return deps.shouldAbort?.() === true;
  };

  const lockAcquired = await tryAcquireRunnerLock({
    lockPath: deps.config.lockFilePath,
    runnerId: deps.config.runnerId,
    pid,
    now: deps.now(),
    store: lockStore,
  });
  if (!lockAcquired) {
    status = "lock_contested";
    const health = buildRunnerHealthSnapshot({
      runnerId: deps.config.runnerId,
      status,
      emergencyStop: false,
      lock: await lockStore.read(deps.config.lockFilePath),
      runnerOwnsLock: false,
      activeAssignmentId: null,
      budget,
      lastCycleAt,
      lastErrorCode: "lock_contested",
    });
    deps.onHealth?.(health);
    return { cyclesCompleted: 0, stopReason: "lock_lost", health };
  }

  const onSignal = () => {
    shuttingDown = true;
    stopReason = "signal";
  };
  attachRunnerSignalHandlers(onSignal);

  const maxCycles = deps.maxCycles ?? Number.POSITIVE_INFINITY;

  try {
    while (!shuttingDown && cyclesCompleted < maxCycles) {
      if ((await emergencyStopActive()) || emergencyStopFilePresent()) {
        emergencyStop = true;
        status = "stopped";
        lastErrorCode = "emergency_stop";
        stopReason = "emergency_stop";
        break;
      }

      budget = normalizeBudgetState(budget, clock());
      const allowance = budgetAllowsCycle(budget, deps.config, true);
      if (!budgetFileHealthy || !allowance.allowed) {
        status = "waiting_budget";
        lastErrorCode = budgetFileHealthy ? allowance.reason : BUDGET_FILE_UNREADABLE_CODE;
        deps.onHealth?.(
          buildRunnerHealthSnapshot({
            runnerId: deps.config.runnerId,
            status,
            emergencyStop: false,
            lock: await lockStore.read(deps.config.lockFilePath),
            runnerOwnsLock: true,
            activeAssignmentId,
            budget,
            lastCycleAt,
            lastErrorCode,
          }),
        );
        await sleep(idleBackoff);
        idleBackoff = Math.min(idleBackoff * 2, deps.config.idleBackoffMaxMs);
        cyclesCompleted += 1;
        if (cyclesCompleted >= maxCycles) {
          break;
        }
        continue;
      }

      status = "running_cycle";
      activeAssignmentId = null;
      deps.onHealth?.(
        buildRunnerHealthSnapshot({
          runnerId: deps.config.runnerId,
          status,
          emergencyStop: false,
          lock: await lockStore.read(deps.config.lockFilePath),
          runnerOwnsLock: true,
          activeAssignmentId,
          budget,
          lastCycleAt,
          lastErrorCode,
        }),
      );

      try {
        if (deps.reloadStore) {
          await deps.reloadStore();
        }
        const cycleResult = await runCursorBridgeAssignmentCycle({
          bridgeEnabled: deps.bridgeEnabled,
          transport: deps.transport,
          config: deps.config.bridgeConfig,
          store: deps.store,
          liveStore: deps.liveStore,
          consumer: deps.consumer,
          dispatchOwnerId: deps.config.dispatchOwnerId,
          polling: deps.polling,
          sleep,
          now: deps.now,
          bearerToken: deps.bearerToken,
          shouldAbort: shouldAbortCycle,
          reserveExternalCreateBudget: async () => {
            if (!budgetFileHealthy) {
              throw new Error(BUDGET_FILE_UNREADABLE_CODE);
            }
            budget = normalizeBudgetState(budget, clock());
            budget = reserveDailyCreateSlot(budget, deps.config, clock());
            await saveBudgetState(budget);
          },
        });
        if (cycleResult) {
          activeAssignmentId = cycleResult.assignmentId;
          lastCycleAt = deps.now();
          lastErrorCode = null;
          idleBackoff = deps.config.idleBackoffMinMs;
        } else {
          status = "idle";
          await sleep(idleBackoff);
          idleBackoff = Math.min(idleBackoff * 2, deps.config.idleBackoffMaxMs);
        }
      } catch (error) {
        lastErrorCode = error instanceof Error ? error.message.slice(0, 120) : "cycle_failed";
        status = "idle";
        await sleep(idleBackoff);
        idleBackoff = Math.min(idleBackoff * 2, deps.config.idleBackoffMaxMs);
      }

      budget = recordRunnerCycle(budget, clock());
      await saveBudgetState(budget);
      cyclesCompleted += 1;
      activeAssignmentId = null;
      status = "idle";
    }
  } finally {
    detachRunnerSignalHandlers();
    await releaseRunnerLock({
      lockPath: deps.config.lockFilePath,
      runnerId: deps.config.runnerId,
      store: lockStore,
    });
  }

  const health = buildRunnerHealthSnapshot({
    runnerId: deps.config.runnerId,
    status: stopReason === "emergency_stop" ? "stopped" : status,
    emergencyStop: stopReason === "emergency_stop",
    lock: await lockStore.read(deps.config.lockFilePath),
    runnerOwnsLock: false,
    activeAssignmentId: null,
    budget,
    lastCycleAt,
    lastErrorCode,
  });
  deps.onHealth?.(health);

  return {
    cyclesCompleted,
    stopReason: stopReason ?? "completed",
    health,
  };
}

let runnerSignalHandler: (() => void) | null = null;

export function attachRunnerSignalHandlers(onSignal: () => void): void {
  if (typeof process === "undefined" || !process.on) return;
  detachRunnerSignalHandlers();
  runnerSignalHandler = onSignal;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export function detachRunnerSignalHandlers(): void {
  if (typeof process === "undefined" || !process.off || !runnerSignalHandler) return;
  process.off("SIGINT", runnerSignalHandler);
  process.off("SIGTERM", runnerSignalHandler);
  runnerSignalHandler = null;
}
