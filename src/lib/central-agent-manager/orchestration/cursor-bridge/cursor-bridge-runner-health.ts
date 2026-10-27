import type { CursorBridgeRunnerBudgetState } from "./cursor-bridge-runner-budget";
import type { CursorBridgeRunnerLockRecord } from "./cursor-bridge-runner-singleton";

export type CursorBridgeRunnerHealthSnapshot = {
  contractVersion: "central-agent-manager-cursor-bridge-runner-health/v1";
  runnerId: string;
  status: "idle" | "running_cycle" | "paused" | "stopped" | "waiting_budget" | "lock_contested";
  emergencyStop: boolean;
  lockHeld: boolean;
  lockOwner: string | null;
  activeAssignmentId: string | null;
  budget: {
    createsToday: number;
    cyclesThisHour: number;
  };
  lastCycleAt: string | null;
  lastErrorCode: string | null;
};

const SECRET_LIKE = /(bearer|api[_-]?key|token|authorization|CURSOR_API_KEY|CENTRAL_AGENT_MANAGER_AGENT_BEARERS)/i;

export function sanitizeRunnerHealthForLog(snapshot: CursorBridgeRunnerHealthSnapshot): string {
  const serialized = JSON.stringify(snapshot);
  if (SECRET_LIKE.test(serialized)) {
    throw new Error("Runner health snapshot must not include credential material.");
  }
  if (snapshot.lastErrorCode && SECRET_LIKE.test(snapshot.lastErrorCode)) {
    throw new Error("Runner health lastErrorCode must not include credential material.");
  }
  return serialized;
}

export function buildRunnerHealthSnapshot(input: {
  runnerId: string;
  status: CursorBridgeRunnerHealthSnapshot["status"];
  emergencyStop: boolean;
  lock: CursorBridgeRunnerLockRecord | null;
  runnerOwnsLock: boolean;
  activeAssignmentId: string | null;
  budget: CursorBridgeRunnerBudgetState;
  lastCycleAt: string | null;
  lastErrorCode: string | null;
}): CursorBridgeRunnerHealthSnapshot {
  return {
    contractVersion: "central-agent-manager-cursor-bridge-runner-health/v1",
    runnerId: input.runnerId,
    status: input.status,
    emergencyStop: input.emergencyStop,
    lockHeld: input.runnerOwnsLock,
    lockOwner: input.lock?.runnerId ?? null,
    activeAssignmentId: input.activeAssignmentId,
    budget: {
      createsToday: input.budget.createsToday,
      cyclesThisHour: input.budget.cyclesThisHour,
    },
    lastCycleAt: input.lastCycleAt,
    lastErrorCode: input.lastErrorCode,
  };
}
