import { SupervisorContractError } from "../supervisor/types";
import type { ManagerAssignmentRecord } from "./contracts-v1";
import { transitionManagerJob } from "./job-state";
import type { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import {
  ORCHESTRATION_EVIDENCE_CONTRACT_V1,
  type OrchestrationEvidenceRecord,
  orchestrationEvidenceKinds,
} from "./orchestration-evidence";

export const MAX_PERSISTED_EVIDENCE_PER_ASSIGNMENT = 24;

function validatePersistedEvidenceRecord(value: unknown): OrchestrationEvidenceRecord {
  if (!value || typeof value !== "object") {
    throw new SupervisorContractError("Persisted evidence entry is invalid.");
  }
  const row = value as OrchestrationEvidenceRecord;
  if (row.contractVersion !== ORCHESTRATION_EVIDENCE_CONTRACT_V1) {
    throw new SupervisorContractError("Persisted evidence contract version is invalid.");
  }
  if (!orchestrationEvidenceKinds.includes(row.kind)) {
    throw new SupervisorContractError("Persisted evidence kind is invalid.");
  }
  if (row.source !== "executor" || row.verification !== "verified") {
    throw new SupervisorContractError("Persisted evidence is not verified.");
  }
  return row;
}

export function validatePersistedEvidenceOnAssignment(
  value: unknown,
): readonly OrchestrationEvidenceRecord[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new SupervisorContractError("Persisted evidence must be an array.");
  }
  if (value.length > MAX_PERSISTED_EVIDENCE_PER_ASSIGNMENT) {
    throw new SupervisorContractError("Persisted evidence exceeds assignment bound.");
  }
  const out: OrchestrationEvidenceRecord[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const record = validatePersistedEvidenceRecord(entry);
    if (ids.has(record.id)) {
      throw new SupervisorContractError("Duplicate persisted evidence id on assignment.");
    }
    ids.add(record.id);
    out.push(record);
  }
  return out;
}

export function appendPersistedEvidenceToAssignment(
  assignment: ManagerAssignmentRecord,
  record: OrchestrationEvidenceRecord,
  now: string,
): ManagerAssignmentRecord {
  if (record.assignmentId !== assignment.id || record.agentId !== assignment.agentId) {
    throw new SupervisorContractError("Evidence is not owned by this assignment.");
  }
  const existing = assignment.persistedEvidence ?? [];
  if (existing.some((row) => row.id === record.id)) {
    throw new SupervisorContractError("Duplicate evidence id.");
  }
  if (existing.length >= MAX_PERSISTED_EVIDENCE_PER_ASSIGNMENT) {
    throw new SupervisorContractError("Persisted evidence exceeds assignment bound.");
  }
  return {
    ...assignment,
    persistedEvidence: [...existing, record],
    updatedAt: now,
  };
}

export function rehydrateEvidenceStoreFromAssignments(store: MemoryOrchestrationQueueStore): void {
  for (const assignment of store.listAssignmentsSync()) {
    for (const record of assignment.persistedEvidence ?? []) {
      store.evidenceStore.rehydrate(record);
    }
  }
}

export function reconcileUnverifiableCompletedJobs(
  store: MemoryOrchestrationQueueStore,
  now: string,
): readonly string[] {
  const blocked: string[] = [];
  for (const job of store.listJobsSync()) {
    if (job.state !== "completed" || !job.evidenceIds.length) continue;
    const assignments = store
      .listAssignmentsSync()
      .filter((row) => row.jobId === job.id && row.state === "completed");
    const primary = assignments.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
    if (!primary) {
      store.restoreJob(
        transitionManagerJob(job, "blocked", {
          now,
          blockReason: "Completed job is missing a completed assignment with durable evidence.",
          idempotent: false,
          reconcileUnverifiableCompletion: true,
        }),
      );
      blocked.push(job.id);
      continue;
    }
    try {
      store.evidenceStore.assertCompletionEvidence(
        primary.id,
        primary.agentId,
        job.id,
        job.evidenceIds,
      );
    } catch {
      store.restoreJob(
        transitionManagerJob(job, "blocked", {
          now,
          blockReason: "Completed job references orchestration evidence that is not durably verifiable.",
          idempotent: false,
          reconcileUnverifiableCompletion: true,
        }),
      );
      blocked.push(job.id);
    }
  }
  return blocked;
}

export function assignmentHasPersistedEvidenceIds(
  assignment: ManagerAssignmentRecord,
  evidenceIds: readonly string[],
): boolean {
  const persisted = new Set((assignment.persistedEvidence ?? []).map((row) => row.id));
  return evidenceIds.every((id) => persisted.has(id));
}
