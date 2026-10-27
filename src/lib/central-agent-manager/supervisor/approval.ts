import { requiresOwnerApproval } from "./protected-operations";
import { getSpecialistProfile } from "./registry";
import {
  assertIdentifier,
  assertTimestamp,
  SupervisorContractError,
  type ApprovalEvidence,
  type SupervisorTask,
} from "./types";

export type ApprovalRejection =
  | "missing"
  | "not_owner"
  | "rejected"
  | "expired"
  | "revoked"
  | "task_mismatch"
  | "operation_mismatch"
  | "version_mismatch";

export function assessApproval(
  task: SupervisorTask,
  operation: string,
  approval: ApprovalEvidence | null,
  now: string,
): { ok: true } | { ok: false; reason: ApprovalRejection } {
  assertTimestamp(now, "Evaluation time");
  if (!approval) return { ok: false, reason: "missing" };
  // Policy matching only. A caller-supplied principal.kind of "owner" is not
  // proof that an authorized owner produced this object.
  if (!approval.principal || approval.principal.kind !== "owner") return { ok: false, reason: "not_owner" };
  if (approval.decision !== "approved") return { ok: false, reason: "rejected" };
  if (approval.revokedAt) return { ok: false, reason: "revoked" };
  if (approval.expiresAt) {
    const expires = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.parse(now)) {
      return { ok: false, reason: "expired" };
    }
  }
  const sameTask =
    approval.taskId === task.id && approval.scope.taskId === task.id;
  if (!sameTask) return { ok: false, reason: "task_mismatch" };
  const sameOperation =
    approval.operation === operation && approval.scope.operation === operation;
  if (!sameOperation) return { ok: false, reason: "operation_mismatch" };
  const sameVersion =
    approval.planVersion === task.planVersion && approval.scope.planVersion === task.planVersion;
  if (!sameVersion) return { ok: false, reason: "version_mismatch" };
  if (!requiresOwnerApproval(operation)) return { ok: true };
  return { ok: true };
}

export function applyOwnerApproval(
  task: SupervisorTask,
  approval: ApprovalEvidence,
  now: string,
): SupervisorTask {
  assertIdentifier(approval.id, "Approval id");
  assertTimestamp(approval.createdAt, "Approval time");
  const operation = approval.operation;
  const profile = getSpecialistProfile(task.specialistId);
  const scope = [...task.requestedOperations, ...task.allowedCapabilityScope];
  if (
    profile.absoluteProhibitions.includes(operation) ||
    !profile.requestableOperations.includes(operation) ||
    scope.some(
      (candidate) =>
        profile.absoluteProhibitions.includes(candidate) ||
        !profile.requestableOperations.includes(candidate),
    )
  ) {
    throw new SupervisorContractError("Approval cannot override a specialist prohibition.");
  }
  if (!task.requestedOperations.includes(operation)) {
    throw new SupervisorContractError("Approval operation is outside the task scope.");
  }
  const assessed = assessApproval(task, operation, approval, now);
  if (!assessed.ok) {
    throw new SupervisorContractError(`Approval evidence was rejected (${assessed.reason}).`);
  }
  throw new SupervisorContractError("Untrusted approval cannot authorize protected work.");
}

export function applyTrustedTaskApproval(task: SupervisorTask, now: string): SupervisorTask {
  assertTimestamp(now, "Update time");
  if (task.state !== "awaiting_approval") {
    throw new SupervisorContractError("Owner approval applies only to a task awaiting approval.");
  }
  return {
    ...task,
    state: "approved",
    approvalState: "owner_approved",
    updatedAt: now,
  };
}
