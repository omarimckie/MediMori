import type { WorkerOutcomeReport } from "../phase6a/closed-loop-manager";
import type { OwnerApprovalRequestV1, ObjectiveExecutionRecordV1 } from "./objective-execution-record";

export type ActionableApprovalRequest = {
  approval: OwnerApprovalRequestV1;
  ownerMessage: string;
  preparatoryDelegation?: {
    role: string;
    reason: string;
  };
};

const PROTECTED_OPERATION_HINTS: Record<string, { operation: string; message: string; prepRole?: string }> = {
  missing_file_permission: {
    operation: "repository_write",
    message: "Grant repository write access for the scoped paths or delegate credential prep to DevOps.",
    prepRole: "devops",
  },
  missing_database_migration: {
    operation: "destructive_database",
    message: "Approve a scoped database migration plan before CAM enqueues migration work.",
  },
  production_deploy: {
    operation: "production_deploy",
    message: "Owner must authorize production deployment with environment and rollback plan.",
    prepRole: "devops",
  },
  unavailable_specialist: {
    operation: "specialist_provisioning",
    message: "Enable an authorized specialist backend or approve deferral.",
  },
  expired_approval: {
    operation: "owner_approval_refresh",
    message: "Re-issue owner approval grant; previous approval is missing or expired.",
  },
};

export function buildActionableApprovalRequest(input: {
  record: ObjectiveExecutionRecordV1;
  report: WorkerOutcomeReport;
  now: string;
  scenarioKey: keyof typeof PROTECTED_OPERATION_HINTS;
}): ActionableApprovalRequest {
  const hint = PROTECTED_OPERATION_HINTS[input.scenarioKey];
  const approval: OwnerApprovalRequestV1 = {
    id: `approval-${input.record.objectiveId}-${input.report.taskId}-${input.scenarioKey}`,
    objectiveId: input.record.objectiveId,
    taskId: input.report.taskId,
    protectedOperation: hint.operation,
    reason: hint.message,
    requestedAt: input.now,
    status: "pending",
  };
  return {
    approval,
    ownerMessage: hint.message,
    preparatoryDelegation: hint.prepRole
      ? { role: hint.prepRole, reason: `Prepare prerequisites for ${hint.operation}.` }
      : undefined,
  };
}

export function attachPendingApproval(
  record: ObjectiveExecutionRecordV1,
  approval: OwnerApprovalRequestV1,
  now: string,
): ObjectiveExecutionRecordV1 {
  const existing = record.pendingApprovals.find((a) => a.id === approval.id);
  if (existing) return record;
  return {
    ...record,
    pendingApprovals: [...record.pendingApprovals, approval],
    lifecycleState: "awaiting_owner_approval",
    updatedAt: now,
  };
}
