import { WorkerLifecycleStore, type WorkerInstanceRecord } from "../phase6a/worker-lifecycle";
import type { ClosedLoopManagerState } from "../phase6a/closed-loop-manager";

export const CLOSED_LOOP_PERSISTENCE_CONTRACT_V1 = "cam-closed-loop-persistence/v1" as const;

export type PersistedClosedLoopManagerStateV1 = {
  contractVersion: typeof CLOSED_LOOP_PERSISTENCE_CONTRACT_V1;
  plan: ClosedLoopManagerState["plan"];
  budgetRemainingUsd: number;
  followUpTasksCreated: number;
  workers: WorkerInstanceRecord[];
  objectiveState: ClosedLoopManagerState["objectiveState"];
  auditLog: string[];
  finalSummary?: string;
};

export function serializeClosedLoopManagerState(state: ClosedLoopManagerState): PersistedClosedLoopManagerStateV1 {
  return {
    contractVersion: CLOSED_LOOP_PERSISTENCE_CONTRACT_V1,
    plan: state.plan,
    budgetRemainingUsd: state.budgetRemainingUsd,
    followUpTasksCreated: state.followUpTasksCreated,
    workers: state.workers.list(),
    objectiveState: state.objectiveState,
    auditLog: [...state.auditLog],
    finalSummary: state.finalSummary,
  };
}

export function deserializeClosedLoopManagerState(payload: PersistedClosedLoopManagerStateV1): ClosedLoopManagerState {
  const workers = new WorkerLifecycleStore();
  workers.hydrate(payload.workers);
  return {
    plan: payload.plan,
    budgetRemainingUsd: payload.budgetRemainingUsd,
    followUpTasksCreated: payload.followUpTasksCreated,
    workers,
    objectiveState: payload.objectiveState,
    auditLog: [...payload.auditLog],
    finalSummary: payload.finalSummary,
  };
}
