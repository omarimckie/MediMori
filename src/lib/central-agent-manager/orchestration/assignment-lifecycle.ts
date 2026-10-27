import { SupervisorContractError } from "../supervisor/types";
import type {
  AssignmentLease,
  ManagerAssignmentRecord,
  ManagerJobRecord,
} from "./contracts-v1";
import type { ExternalExecutionReferences } from "./external-execution-refs";
import { ORCHESTRATION_ASSIGNMENT_CONTRACT_V1 } from "./contracts-v1";
import { transitionManagerJob } from "./job-state";

export const DEFAULT_LEASE_MS = 10 * 60 * 1000;

export function createAssignmentLease(
  agentId: string,
  leasedAt: string,
  leaseMs: number,
  dispatchAttempt: number,
  fenceToken: number,
): AssignmentLease {
  const start = Date.parse(leasedAt);
  return {
    holderAgentId: agentId,
    leasedAt,
    expiresAt: new Date(start + leaseMs).toISOString(),
    dispatchAttempt,
    fenceToken,
  };
}

export function assertAssignmentFence(job: ManagerJobRecord, assignment: ManagerAssignmentRecord): void {
  if (job.activeLeaseFence === null) {
    throw new SupervisorContractError("Job has no active lease fence.");
  }
  if (assignment.lease.fenceToken !== job.activeLeaseFence) {
    throw new SupervisorContractError("Assignment fence token does not match the active job lease.");
  }
}

export function createAssignmentRecord(input: {
  id: string;
  job: ManagerJobRecord;
  agentId: string;
  now: string;
  leaseMs?: number;
  dispatchAttempt: number;
  fenceToken: number;
  externalRefs?: ExternalExecutionReferences;
}): ManagerAssignmentRecord {
  const externalRefs = input.externalRefs ?? input.job.externalRefs;
  return {
    contractVersion: ORCHESTRATION_ASSIGNMENT_CONTRACT_V1,
    id: input.id,
    jobId: input.job.id,
    projectId: input.job.projectId,
    agentId: input.agentId,
    state: "active",
    ...(externalRefs ? { externalRefs } : {}),
    lease: createAssignmentLease(
      input.agentId,
      input.now,
      input.leaseMs ?? DEFAULT_LEASE_MS,
      input.dispatchAttempt,
      input.fenceToken,
    ),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function assignmentLeaseExpired(assignment: ManagerAssignmentRecord, now: string): boolean {
  return Date.parse(assignment.lease.expiresAt) <= Date.parse(now);
}

export function assertActiveAssignmentForAgent(
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  agentId: string,
  fenceToken: number,
  now: string,
): void {
  if (assignment.agentId !== agentId) {
    throw new SupervisorContractError("Assignment is not owned by this agent.");
  }
  if (assignment.state !== "active") {
    throw new SupervisorContractError("Assignment is not active.");
  }
  if (assignment.lease.fenceToken !== fenceToken) {
    throw new SupervisorContractError("Assignment fence token is stale.");
  }
  assertAssignmentFence(job, assignment);
  if (assignmentLeaseExpired(assignment, now)) {
    throw new SupervisorContractError("Assignment lease has expired.");
  }
}

export function extendAssignmentLease(
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  agentId: string,
  now: string,
  fenceToken: number,
  leaseMs: number = DEFAULT_LEASE_MS,
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  const lease = createAssignmentLease(
    agentId,
    now,
    leaseMs,
    assignment.lease.dispatchAttempt,
    fenceToken,
  );
  return {
    assignment: { ...assignment, lease, updatedAt: now },
    job,
  };
}

export function releaseExpiredLease(
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  now: string,
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  if (assignment.state !== "active") {
    return { assignment, job };
  }
  if (!assignmentLeaseExpired(assignment, now)) {
    return { assignment, job };
  }
  const released: ManagerAssignmentRecord = {
    ...assignment,
    state: "released",
    updatedAt: now,
  };
  const nextAttempt = job.attemptCount + 1;
  const canRetry = job.retryEligible && nextAttempt < job.maxAttempts;
  const jobAfter = transitionManagerJob(
    { ...job, attemptCount: nextAttempt, assignmentId: null, activeLeaseFence: null },
    canRetry ? "ready" : "failed",
    {
      now,
      failureReason: canRetry ? null : "Assignment lease expired and retry limit reached.",
      idempotent: false,
    },
  );
  return { assignment: released, job: jobAfter };
}

export function markAssignmentAmbiguous(
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  now: string,
  reason: string,
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  if (assignment.state !== "active") {
    throw new SupervisorContractError("Only active assignments can become ambiguous.");
  }
  const ambiguous: ManagerAssignmentRecord = {
    ...assignment,
    state: "ambiguous",
    updatedAt: now,
  };
  const blockedJob = transitionManagerJob(
    { ...job, assignmentId: assignment.id, activeLeaseFence: assignment.lease.fenceToken },
    "blocked",
    {
      now,
      blockReason: `Ambiguous execution outcome: ${reason}. Manual review required before reassignment.`,
      idempotent: false,
    },
  );
  return { assignment: ambiguous, job: blockedJob };
}

export function completeAssignmentSuccess(
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  now: string,
  evidenceIds: readonly string[],
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  if (assignment.state !== "active") {
    throw new SupervisorContractError("Only active assignments can complete.");
  }
  assertAssignmentFence(job, assignment);
  const completedAssignment: ManagerAssignmentRecord = {
    ...assignment,
    state: "completed",
    updatedAt: now,
  };
  const completedJob = transitionManagerJob(
    { ...job, assignmentId: null, activeLeaseFence: null },
    "completed",
    { now, evidenceIds, idempotent: false },
  );
  return { assignment: completedAssignment, job: completedJob };
}

export function failAssignment(
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  now: string,
  reason: string,
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  if (assignment.state !== "active") {
    throw new SupervisorContractError("Only active assignments can fail.");
  }
  const failedAssignment: ManagerAssignmentRecord = {
    ...assignment,
    state: "failed",
    updatedAt: now,
  };
  const nextAttempt = job.attemptCount + 1;
  const canRetry = job.retryEligible && nextAttempt < job.maxAttempts;
  const jobAfter = transitionManagerJob(
    { ...job, attemptCount: nextAttempt, assignmentId: null, activeLeaseFence: null },
    canRetry ? "ready" : "failed",
    {
      now,
      failureReason: reason,
      idempotent: false,
    },
  );
  return { assignment: failedAssignment, job: jobAfter };
}
