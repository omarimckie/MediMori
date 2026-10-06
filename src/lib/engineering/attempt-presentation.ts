import type { ExecutionAttempt } from "./store";

export type AttemptDisplayTask = {
  status: string;
  attempts?: ExecutionAttempt[];
  latestPreparation?: { previousAttemptNumber: number; toVersion: number } | null;
};

export function attemptPresentation(task: AttemptDisplayTask) {
  const attempts = task.attempts ?? [];
  const current = attempts[0];
  const stopped = current && ["expired", "blocked", "cancelled"].includes(current.disposition);
  const retryableTaskState = ["implementing", "validating", "repairing", "reviewing", "blocked", "cancelled"].includes(task.status);
  return {
    attempts,
    current,
    canPrepare: Boolean(stopped && retryableTaskState),
    nextAttemptNumber: task.status === "analyzing" && task.latestPreparation
      ? task.latestPreparation.previousAttemptNumber + 1
      : current ? current.attemptNumber + 1 : task.latestPreparation ? task.latestPreparation.previousAttemptNumber + 1 : 1,
    freshApprovalRequired: task.status === "analyzing" && Boolean(task.latestPreparation),
  };
}
