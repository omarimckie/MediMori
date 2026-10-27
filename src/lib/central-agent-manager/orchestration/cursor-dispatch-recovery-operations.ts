import { SupervisorContractError } from "../supervisor/types";
import { DEFAULT_LEASE_MS } from "./assignment-lifecycle";
import type { ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import {
  type CursorDispatchIntent,
  CURSOR_DISPATCH_INTENT_CONTRACT_V1,
  effectiveCursorDispatchState,
  persistAssignmentAndJobCursorIntent,
} from "./cursor-dispatch-intent";
import {
  appendRecoveryAuditRecord,
  type CursorDispatchRecoveryAuditRecord,
} from "./cursor-dispatch-recovery-audit";
import {
  hasConfirmedCursorExternalIds,
  validateExternalExecutionReferences,
  type ExternalExecutionReferences,
} from "./external-execution-refs";
import type { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { transitionManagerJob } from "./job-state";

export type CursorDispatchRecoveryProjection = {
  assignmentId: string;
  jobId: string;
  projectId: ManagerAssignmentRecord["projectId"];
  agentId: string;
  assignmentState: ManagerAssignmentRecord["state"];
  jobState: ManagerJobRecord["state"];
  dispatchIntentState: string;
  recoveryReason: string | null;
  externalRefs: ExternalExecutionReferences | null;
  leaseFenceToken: number;
  leaseExpiresAt: string;
  recoveryAuditCount: number;
};

export function listCursorDispatchRecoveryCandidates(
  store: MemoryOrchestrationQueueStore,
): CursorDispatchRecoveryProjection[] {
  const jobs = new Map(store.listJobsSync().map((job) => [job.id, job]));
  const rows: CursorDispatchRecoveryProjection[] = [];
  for (const assignment of store.listAssignmentsSync()) {
    const intentState = effectiveCursorDispatchState(assignment.cursorDispatchIntent);
    if (intentState !== "recovery_required" && intentState !== "outcome_unknown") continue;
    const job = jobs.get(assignment.jobId);
    if (!job) continue;
    rows.push({
      assignmentId: assignment.id,
      jobId: assignment.jobId,
      projectId: assignment.projectId,
      agentId: assignment.agentId,
      assignmentState: assignment.state,
      jobState: job.state,
      dispatchIntentState: intentState,
      recoveryReason: assignment.cursorDispatchIntent?.recoveryReason ?? null,
      externalRefs: assignment.externalRefs ?? null,
      leaseFenceToken: assignment.lease.fenceToken,
      leaseExpiresAt: assignment.lease.expiresAt,
      recoveryAuditCount: assignment.cursorDispatchRecoveryAudit?.length ?? 0,
    });
  }
  return rows.sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
}

function assertRecoveryEligible(assignment: ManagerAssignmentRecord, job: ManagerJobRecord): void {
  const intentState = effectiveCursorDispatchState(assignment.cursorDispatchIntent);
  if (intentState !== "recovery_required" && intentState !== "outcome_unknown") {
    throw new SupervisorContractError("Assignment is not awaiting operator recovery.");
  }
  if (assignment.state !== "ambiguous" && assignment.state !== "active") {
    throw new SupervisorContractError("Assignment is not in a recoverable state.");
  }
  if (job.ownerAuthorizationScope === "owner_approval_required" && !job.approvalBinding) {
    throw new SupervisorContractError("Protected job still requires owner approval before recovery.");
  }
}

function buildAudit(
  action: CursorDispatchRecoveryAuditRecord["action"],
  input: {
    id: string;
    ownerUsername: string;
    assignment: ManagerAssignmentRecord;
    job: ManagerJobRecord;
    now: string;
    reason?: string;
    externalRefs?: ExternalExecutionReferences;
  },
): CursorDispatchRecoveryAuditRecord {
  return {
    contractVersion: "central-agent-manager-cursor-recovery-audit/v1",
    id: input.id,
    action,
    recordedAt: input.now,
    ownerUsername: input.ownerUsername,
    assignmentId: input.assignment.id,
    jobId: input.job.id,
    ...(input.reason ? { reason: input.reason.slice(0, 240) } : {}),
    ...(input.externalRefs?.cursorAgentId ? { cursorAgentId: input.externalRefs.cursorAgentId } : {}),
    ...(input.externalRefs?.cursorRunId ? { cursorRunId: input.externalRefs.cursorRunId } : {}),
  };
}

export function ownerConfirmVerifiedCursorIdsSync(
  store: MemoryOrchestrationQueueStore,
  input: {
    assignmentId: string;
    ownerUsername: string;
    externalRefs: ExternalExecutionReferences;
    auditId: string;
    now: string;
    leaseMs?: number;
  },
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  const assignment = store.listAssignmentsSync().find((row) => row.id === input.assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertRecoveryEligible(assignment, job);
  const refs = validateExternalExecutionReferences(input.externalRefs);
  if (!refs) {
    throw new SupervisorContractError("Verified external references are required.");
  }
  if (!refs.cursorAgentId || !refs.cursorRunId) {
    throw new SupervisorContractError("Verified Cursor agent and run ids are required.");
  }
  if (assignment.externalRefs?.cursorAgentId && assignment.externalRefs.cursorAgentId !== refs.cursorAgentId) {
    throw new SupervisorContractError("Confirmed Cursor agent id conflicts with stored assignment refs.");
  }
  if (assignment.externalRefs?.cursorRunId && assignment.externalRefs.cursorRunId !== refs.cursorRunId) {
    throw new SupervisorContractError("Confirmed Cursor run id conflicts with stored assignment refs.");
  }
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const expiresAt = new Date(Date.parse(input.now) + leaseMs).toISOString();
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "external_confirmed",
    updatedAt: input.now,
    leaseFenceToken: assignment.lease.fenceToken,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    startedAt: assignment.cursorDispatchIntent?.startedAt,
  };
  const resumedAssignment: ManagerAssignmentRecord = {
    ...assignment,
    state: "active",
    externalRefs: { ...assignment.externalRefs, ...refs },
    lease: {
      ...assignment.lease,
      expiresAt,
      leasedAt: input.now,
    },
    cursorDispatchRecoveryAudit: appendRecoveryAuditRecord(
      assignment.cursorDispatchRecoveryAudit,
      buildAudit("confirm_verified_external_ids", {
        id: input.auditId,
        ownerUsername: input.ownerUsername,
        assignment,
        job,
        now: input.now,
        externalRefs: refs,
      }),
    ),
    updatedAt: input.now,
  };
  const readyJob = transitionManagerJob(
    {
      ...job,
      externalRefs: { ...job.externalRefs, ...refs },
      assignmentId: assignment.id,
      activeLeaseFence: assignment.lease.fenceToken,
    },
    "ready",
    { now: input.now, blockReason: null, idempotent: false },
  );
  const assignedJob = transitionManagerJob(
    { ...readyJob, assignmentId: assignment.id, activeLeaseFence: assignment.lease.fenceToken },
    "assigned",
    { now: input.now, idempotent: true },
  );
  const runningJob = transitionManagerJob(
    { ...assignedJob, assignmentId: assignment.id, activeLeaseFence: assignment.lease.fenceToken },
    "running",
    { now: input.now, idempotent: true },
  );
  const withIntent = persistAssignmentAndJobCursorIntent(store, resumedAssignment, runningJob, intent, input.now);
  if (!hasConfirmedCursorExternalIds(withIntent.assignment.externalRefs)) {
    throw new SupervisorContractError("Confirmed external ids were not persisted.");
  }
  return withIntent;
}

export function ownerFailCursorDispatchRecoverySync(
  store: MemoryOrchestrationQueueStore,
  input: {
    assignmentId: string;
    ownerUsername: string;
    reason: string;
    auditId: string;
    now: string;
  },
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  const assignment = store.listAssignmentsSync().find((row) => row.id === input.assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertRecoveryEligible(assignment, job);
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "dispatch_failed",
    updatedAt: input.now,
    failureReason: input.reason.slice(0, 240),
    leaseFenceToken: assignment.lease.fenceToken,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    startedAt: assignment.cursorDispatchIntent?.startedAt,
  };
  const failedAssignment: ManagerAssignmentRecord = {
    ...assignment,
    state: "ambiguous",
    cursorDispatchRecoveryAudit: appendRecoveryAuditRecord(
      assignment.cursorDispatchRecoveryAudit,
      buildAudit("fail_external_dispatch", {
        id: input.auditId,
        ownerUsername: input.ownerUsername,
        assignment,
        job,
        now: input.now,
        reason: input.reason,
      }),
    ),
    updatedAt: input.now,
  };
  const failedJob = transitionManagerJob(
    { ...job, assignmentId: assignment.id, activeLeaseFence: assignment.lease.fenceToken },
    "cancelled",
    { now: input.now, idempotent: false },
  );
  return persistAssignmentAndJobCursorIntent(store, failedAssignment, failedJob, intent, input.now);
}

export function ownerCancelCursorDispatchRecoverySync(
  store: MemoryOrchestrationQueueStore,
  input: {
    assignmentId: string;
    ownerUsername: string;
    reason: string;
    auditId: string;
    now: string;
  },
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  const assignment = store.listAssignmentsSync().find((row) => row.id === input.assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertRecoveryEligible(assignment, job);
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "dispatch_failed",
    updatedAt: input.now,
    failureReason: `Owner cancelled external dispatch: ${input.reason}`.slice(0, 240),
    leaseFenceToken: assignment.lease.fenceToken,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    startedAt: assignment.cursorDispatchIntent?.startedAt,
  };
  const cancelledAssignment: ManagerAssignmentRecord = {
    ...assignment,
    state: "released",
    cursorDispatchRecoveryAudit: appendRecoveryAuditRecord(
      assignment.cursorDispatchRecoveryAudit,
      buildAudit("cancel_external_dispatch", {
        id: input.auditId,
        ownerUsername: input.ownerUsername,
        assignment,
        job,
        now: input.now,
        reason: input.reason,
      }),
    ),
    updatedAt: input.now,
  };
  const readyJob = transitionManagerJob(
    { ...job, assignmentId: null, activeLeaseFence: null },
    "cancelled",
    { now: input.now, idempotent: false },
  );
  return persistAssignmentAndJobCursorIntent(store, cancelledAssignment, readyJob, intent, input.now);
}
