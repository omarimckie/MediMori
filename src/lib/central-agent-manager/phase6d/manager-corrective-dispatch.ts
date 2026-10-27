import { decideRecoveryAction, type ClosedLoopManagerState, type WorkerOutcomeReport } from "../phase6a/closed-loop-manager";
import type { WorkerBackendAvailability } from "../phase6a/worker-matching";
import type { ObjectiveExecutionRecordV1 } from "../phase6b/objective-execution-record";

export type ManagerCorrectiveDispatchDecision = {
  action: ReturnType<typeof decideRecoveryAction>;
  mayEnqueueCorrective: boolean;
  mayReassignWorker: boolean;
  requiresOwnerApproval: boolean;
  blockedReason?: string;
};

const MAX_CORRECTIVE_DEPTH = 12;

export function planManagerCorrectiveDispatch(input: {
  record: ObjectiveExecutionRecordV1;
  report: WorkerOutcomeReport;
  backends: readonly WorkerBackendAvailability[];
}): ManagerCorrectiveDispatchDecision {
  const state: ClosedLoopManagerState = input.record.closedLoop;
  const action = decideRecoveryAction(input.report, state);
  const depth = state.followUpTasksCreated;
  if (depth >= MAX_CORRECTIVE_DEPTH || depth >= state.plan.retryPolicy.maxFollowUpTasks) {
    return {
      action: "escalate_unresolved",
      mayEnqueueCorrective: false,
      mayReassignWorker: false,
      requiresOwnerApproval: false,
      blockedReason: "follow_up_cap",
    };
  }
  const requiresOwnerApproval = action === "request_owner_approval";
  const mayEnqueueCorrective = action === "create_corrective_subtask";
  const mayReassignWorker = action === "reassign_authorized_specialist";
  if (mayReassignWorker) {
    const privileged = input.backends.some((b) => b.role === "devops" && b.adapterEnabled);
    if (!privileged) {
      return {
        action: "request_owner_approval",
        mayEnqueueCorrective: false,
        mayReassignWorker: false,
        requiresOwnerApproval: true,
        blockedReason: "no_authorized_reassign_target",
      };
    }
  }
  return {
    action,
    mayEnqueueCorrective,
    mayReassignWorker,
    requiresOwnerApproval,
  };
}
