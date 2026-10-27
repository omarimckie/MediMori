import type { ClosedLoopManagerState } from "./closed-loop-manager";

export const OWNER_PROGRESS_CONTRACT_V1 = "cam-owner-progress/v1" as const;

export type OwnerProgressReportV1 = {
  contractVersion: typeof OWNER_PROGRESS_CONTRACT_V1;
  objectiveId: string;
  objectiveStatus: ClosedLoopManagerState["objectiveState"];
  completedTasks: string[];
  activeTasks: string[];
  assignedSpecialists: { workerId: string; role: string; taskId: string; state: string }[];
  currentBlocker: string | null;
  recoveryAction: string | null;
  requiredOwnerDecision: string | null;
  evidenceStatus: { taskId: string; evidenceIds: string[] }[];
  budgetConsumedUsd: number;
  budgetRemainingUsd: number;
  finalOutcome: string | null;
};

export function buildOwnerProgressReport(state: ClosedLoopManagerState): OwnerProgressReportV1 {
  const completedTasks = state.plan.tasks.filter((t) => t.state === "completed").map((t) => t.id);
  const activeTasks = state.plan.tasks
    .filter((t) => t.state === "ready" || t.state === "running" || t.state === "pending")
    .map((t) => t.id);
  const workers = state.workers.list();
  const blockerTask = state.plan.tasks.find((t) => t.state === "blocked" || t.state === "failed");
  const lastAudit = state.auditLog[state.auditLog.length - 1] ?? null;
  return {
    contractVersion: OWNER_PROGRESS_CONTRACT_V1,
    objectiveId: state.plan.objectiveId,
    objectiveStatus: state.objectiveState,
    completedTasks,
    activeTasks,
    assignedSpecialists: workers.map((w) => ({
      workerId: w.workerId,
      role: w.role,
      taskId: w.taskId,
      state: w.state,
    })),
    currentBlocker: blockerTask ? `${blockerTask.id}:${blockerTask.state}` : null,
    recoveryAction: lastAudit?.split(":").slice(3).join(":") ?? null,
    requiredOwnerDecision:
      state.objectiveState === "awaiting_owner_approval" ? "owner_approval_for_protected_operation" : null,
    evidenceStatus: workers.map((w) => ({ taskId: w.taskId, evidenceIds: [...w.evidenceIds] })),
    budgetConsumedUsd: state.plan.budgetUsd - state.budgetRemainingUsd,
    budgetRemainingUsd: state.budgetRemainingUsd,
    finalOutcome: state.finalSummary ?? null,
  };
}
