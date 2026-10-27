import { budgetBlockReason } from "../supervisor/budget";
import { SupervisorContractError } from "../supervisor/types";
import {
  attachAssignmentToAgent,
  agentEligibleForProject,
  agentHasCapabilities,
  agentHasCapacity,
} from "./agent-capacity";
import {
  createAssignmentRecord,
  extendAssignmentLease,
  assertActiveAssignmentForAgent,
} from "./assignment-lifecycle";
import { jobRequiresLiveOwnerApproval } from "./approval-integration";
import type { ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import { transitionManagerJob } from "./job-state";
import type { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import {
  acceptOrchestrationEvidence,
  type OrchestrationEvidenceKind,
} from "./orchestration-evidence";
import { assignmentHasPersistedEvidenceIds } from "./orchestration-evidence-lifecycle";
import {
  CURSOR_DISPATCH_INTENT_CONTRACT_V1,
  assertMayBeginExternalDispatch,
  assertMayCorrelateExternalDispatch,
  persistAssignmentAndJobCursorIntent,
  type CursorDispatchIntent,
} from "./cursor-dispatch-intent";
import {
  hasConfirmedCursorExternalIds,
  mergeExternalExecutionReferences,
  validateCursorDispatchCorrelationPatch,
} from "./external-execution-refs";
import { isProtectedStagingJobId, rejectConsumerMutationOnAuditJob } from "./consumer-runtime-safety";
import { listReadyJobs } from "./scheduler";

export function listActiveAssignmentsForAgentSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
): ManagerAssignmentRecord[] {
  return store
    .listAssignmentsSync()
    .filter((row) => row.agentId === agentId && row.state === "active")
    .sort((a, b) => a.id.localeCompare(b.id));
}

export type PlannedAssignmentClaim = {
  record: ManagerAssignmentRecord;
  runningJob: ManagerJobRecord;
};

export function planNextAssignmentClaim(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  now: string,
  options?: { jobId?: string; leaseMs?: number; staleAfterMs?: number },
): PlannedAssignmentClaim | null {
  const existing = listActiveAssignmentsForAgentSync(store, agentId);
  if (existing.length) {
    const job = store.getJobSync(existing[0]!.jobId);
    if (!job) return null;
    return { record: existing[0]!, runningJob: job };
  }

  const agent = store.listAgentsSync().find((row) => row.id === agentId);
  if (!agent) throw new SupervisorContractError("Unknown agent.");

  const nowMs = Date.parse(now);
  if (!agentHasCapacity(agent, nowMs, options?.staleAfterMs)) {
    return null;
  }

  const activeByJob = new Set(
    store
      .listAssignmentsSync()
      .filter((row) => row.state === "active")
      .map((row) => row.jobId),
  );

  if (options?.jobId) {
    rejectConsumerMutationOnAuditJob(options.jobId);
  }

  const ready = listReadyJobs(store.listJobsSync()).filter((job) => {
    if (isProtectedStagingJobId(job.id)) return false;
    if (activeByJob.has(job.id)) return false;
    if (options?.jobId && job.id !== options.jobId) return false;
    if (!agentEligibleForProject(agent, job.projectId)) return false;
    if (!agentHasCapabilities(agent, job.requiredCapabilities)) return false;
    if (jobRequiresLiveOwnerApproval(job, now)) return false;
    if (budgetBlockReason(job.budget, job.usage)) return false;
    return true;
  });

  const job = ready[0];
  if (!job) return null;

  const assignmentId = `asgn-${job.id}-${job.attemptCount + 1}`;
  if (store.listAssignmentsSync().some((row) => row.id === assignmentId)) {
    return null;
  }

  const latestJob = store.getJobSync(job.id);
  if (!latestJob || latestJob.state !== "ready") {
    return null;
  }

  const assignedJob = transitionManagerJob(latestJob, "assigned", {
    now,
    assignmentId,
    idempotent: false,
  });
  const fenceToken = (latestJob.activeLeaseFence ?? 0) + 1;
  const runningJob = transitionManagerJob(
    { ...assignedJob, activeLeaseFence: fenceToken },
    "running",
    { now, assignmentId, idempotent: false },
  );
  const record = createAssignmentRecord({
    id: assignmentId,
    job: runningJob,
    agentId,
    now,
    leaseMs: options?.leaseMs,
    dispatchAttempt: runningJob.attemptCount + 1,
    fenceToken,
    externalRefs: runningJob.externalRefs,
  });
  return { record, runningJob };
}

export function applyPlannedAssignmentClaim(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  plan: PlannedAssignmentClaim,
): ManagerAssignmentRecord {
  store.restoreJob(plan.runningJob);
  store.restoreAssignment(plan.record);
  const refreshedAgent = store.listAgentsSync().find((row) => row.id === agentId);
  if (refreshedAgent) {
    store.registerAgentSync(attachAssignmentToAgent(refreshedAgent, plan.record.id));
  }
  return plan.record;
}

export function claimNextAssignmentForAgentSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  now: string,
  options?: { jobId?: string; leaseMs?: number; staleAfterMs?: number },
): ManagerAssignmentRecord | null {
  store.reconcileLeasesSync(now);
  store.refreshDependencyReadinessSync(now);
  const plan = planNextAssignmentClaim(store, agentId, now, options);
  if (!plan) return null;
  const held = store.listAssignmentsSync().find((row) => row.id === plan.record.id && row.state === "active");
  if (held) return held;
  return applyPlannedAssignmentClaim(store, agentId, plan);
}

export function heartbeatAssignmentSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  progress?: { diagnostic?: string | null; artifactRef?: string | null },
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  const extended = extendAssignmentLease(assignment, job, agentId, now, fenceToken);
  store.restoreAssignment(extended.assignment);
  if (progress?.diagnostic || progress?.artifactRef) {
    const evidenceId = `ev-progress-${assignmentId}-${Date.parse(now)}`;
    const record = acceptOrchestrationEvidence({
      id: evidenceId,
      jobId: assignment.jobId,
      assignmentId,
      agentId,
      kind: "progress_note",
      createdAt: now,
      artifactRef: progress.artifactRef ?? null,
      diagnostic: progress.diagnostic ?? null,
    });
    store.persistOrchestrationEvidenceSync(assignmentId, record, now);
  }
  return extended.assignment;
}

export function beginExternalDispatchSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  dispatchOwnerId: string,
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  assertMayBeginExternalDispatch(assignment, fenceToken, dispatchOwnerId);
  if (
    assignment.cursorDispatchIntent?.state === "dispatch_in_progress" &&
    assignment.cursorDispatchIntent.dispatchOwnerId === dispatchOwnerId &&
    assignment.cursorDispatchIntent.leaseFenceToken === fenceToken
  ) {
    return assignment;
  }
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "dispatch_in_progress",
    updatedAt: now,
    startedAt: assignment.cursorDispatchIntent?.startedAt ?? now,
    dispatchOwnerId,
    leaseFenceToken: fenceToken,
  };
  return persistAssignmentAndJobCursorIntent(store, assignment, job, intent, now).assignment;
}

export function correlateAssignmentExternalRefsSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  externalRefsPatch: Record<string, unknown>,
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  assertMayCorrelateExternalDispatch(assignment, fenceToken);
  const patch = validateCursorDispatchCorrelationPatch(externalRefsPatch);
  if (!hasConfirmedCursorExternalIds(patch)) {
    throw new SupervisorContractError("External correlation requires cursor agent and run ids.");
  }
  const mergedAssignmentRefs = mergeExternalExecutionReferences(assignment.externalRefs, patch);
  const mergedJobRefs = mergeExternalExecutionReferences(job.externalRefs, patch);
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "external_confirmed",
    updatedAt: now,
    startedAt: assignment.cursorDispatchIntent?.startedAt,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    leaseFenceToken: fenceToken,
  };
  const updatedAssignment: ManagerAssignmentRecord = {
    ...assignment,
    externalRefs: mergedAssignmentRefs,
    cursorDispatchIntent: intent,
    updatedAt: now,
  };
  const updatedJob: ManagerJobRecord = {
    ...job,
    externalRefs: mergedJobRefs,
    cursorDispatchIntent: intent,
    updatedAt: now,
  };
  store.restoreJob(updatedJob);
  store.restoreAssignment(updatedAssignment);
  return updatedAssignment;
}

export function markExternalDispatchOutcomeUnknownSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "outcome_unknown",
    updatedAt: now,
    startedAt: assignment.cursorDispatchIntent?.startedAt ?? now,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    leaseFenceToken: fenceToken,
  };
  return persistAssignmentAndJobCursorIntent(store, assignment, job, intent, now).assignment;
}

export function markExternalDispatchFailedSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  reason: string,
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "dispatch_failed",
    updatedAt: now,
    failureReason: reason.slice(0, 240),
    startedAt: assignment.cursorDispatchIntent?.startedAt,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    leaseFenceToken: fenceToken,
  };
  return persistAssignmentAndJobCursorIntent(store, assignment, job, intent, now).assignment;
}

export function submitAssignmentEvidenceSync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  evidence: {
    id: string;
    kind: OrchestrationEvidenceKind;
    artifactRef?: string | null;
    diagnostic?: string | null;
  },
): void {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  const record = acceptOrchestrationEvidence({
    id: evidence.id,
    jobId: assignment.jobId,
    assignmentId,
    agentId,
    kind: evidence.kind,
    createdAt: now,
    artifactRef: evidence.artifactRef ?? null,
    diagnostic: evidence.diagnostic ?? null,
  });
  store.persistOrchestrationEvidenceSync(assignmentId, record, now);
}

export function validateAgentAssignmentCompletion(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  evidenceIds: readonly string[],
): readonly string[] {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  if (assignment.state === "completed") {
    return evidenceIds;
  }
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
  const validated = store.evidenceStore.assertCompletionEvidence(
    assignmentId,
    agentId,
    assignment.jobId,
    evidenceIds,
  );
  if (!assignmentHasPersistedEvidenceIds(assignment, validated)) {
    throw new SupervisorContractError("Completion references evidence that is not durably persisted.");
  }
  return validated;
}

export function validateAgentAssignmentFailure(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
): void {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  assertActiveAssignmentForAgent(assignment, job, agentId, fenceToken, now);
}
