import { requiresOwnerApproval } from "../supervisor/protected-operations";
import { SupervisorContractError } from "../supervisor/types";
import type { JobApprovalBinding, ManagerJobRecord, OwnerAuthorizationScope } from "./contracts-v1";
import { transitionManagerJob } from "./job-state";

export function classifyOwnerAuthorizationScope(requestedOperation: string | null): OwnerAuthorizationScope {
  if (!requestedOperation) return "implementation_safe";
  return requiresOwnerApproval(requestedOperation) ? "owner_approval_required" : "implementation_safe";
}

export function jobRequiresLiveOwnerApproval(job: ManagerJobRecord, now: string): boolean {
  if (job.ownerAuthorizationScope !== "owner_approval_required") return false;
  const binding = job.approvalBinding;
  if (!binding) return true;
  if (binding.revokedAt) return true;
  if (binding.expiresAt && Date.parse(binding.expiresAt) <= Date.parse(now)) return true;
  if (!binding.approvalRecordId) return true;
  return false;
}

export function assertApprovalBoundToJobAction(
  job: ManagerJobRecord,
  operation: string,
  supervisorTaskId: string,
): void {
  if (!job.approvalBinding) {
    throw new SupervisorContractError("Protected job is missing an approval binding.");
  }
  if (job.approvalBinding.operation !== operation || job.approvalBinding.supervisorTaskId !== supervisorTaskId) {
    throw new SupervisorContractError("Approval binding does not match the requested job action.");
  }
}

export function applyApprovalBinding(
  job: ManagerJobRecord,
  binding: JobApprovalBinding,
  now: string,
): ManagerJobRecord {
  return {
    ...job,
    approvalBinding: binding,
    supervisorTaskId: binding.supervisorTaskId,
    updatedAt: now,
  };
}

export function gateJobForApproval(job: ManagerJobRecord, now: string): ManagerJobRecord {
  if (job.ownerAuthorizationScope !== "owner_approval_required") return job;
  if (!jobRequiresLiveOwnerApproval(job, now)) {
    if (job.state === "awaiting_approval") {
      return transitionManagerJob(job, "ready", { now, idempotent: true });
    }
    return job;
  }
  if (job.state === "ready") {
    return transitionManagerJob(job, "awaiting_approval", {
      now,
      blockReason: "Waiting for owner approval bound to this task and operation.",
    });
  }
  return job;
}
