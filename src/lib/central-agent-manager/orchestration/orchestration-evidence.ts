import { scrubSecretsFromString } from "../scrub-response";
import { SupervisorContractError } from "../supervisor/types";
import { assertIdentifier, assertTimestamp } from "../supervisor/types";

export const ORCHESTRATION_EVIDENCE_CONTRACT_V1 = "central-agent-orchestration-evidence/v1" as const;

export const orchestrationEvidenceKinds = ["work_completed", "progress_note"] as const;
export type OrchestrationEvidenceKind = (typeof orchestrationEvidenceKinds)[number];

export type OrchestrationEvidenceRecord = {
  contractVersion: typeof ORCHESTRATION_EVIDENCE_CONTRACT_V1;
  id: string;
  jobId: string;
  assignmentId: string;
  agentId: string;
  kind: OrchestrationEvidenceKind;
  source: "executor";
  verification: "verified";
  createdAt: string;
  artifactRef: string | null;
  diagnostic: string | null;
};

const artifactPattern = /^[\w./-]{1,240}$/;

export type SubmitOrchestrationEvidenceInput = {
  id: string;
  jobId: string;
  assignmentId: string;
  agentId: string;
  kind: OrchestrationEvidenceKind;
  createdAt: string;
  artifactRef?: string | null;
  diagnostic?: string | null;
};

export function acceptOrchestrationEvidence(input: SubmitOrchestrationEvidenceInput): OrchestrationEvidenceRecord {
  assertIdentifier(input.id, "Evidence id");
  assertIdentifier(input.jobId, "Job id");
  assertIdentifier(input.assignmentId, "Assignment id");
  assertIdentifier(input.agentId, "Agent id");
  assertTimestamp(input.createdAt, "Evidence time");
  if (!orchestrationEvidenceKinds.includes(input.kind)) {
    throw new SupervisorContractError("Evidence kind is invalid.");
  }
  const artifactRef =
    input.artifactRef === undefined || input.artifactRef === null
      ? null
      : artifactPattern.test(input.artifactRef)
        ? input.artifactRef
        : (() => {
            throw new SupervisorContractError("Evidence artifact reference is invalid.");
          })();
  const diagnostic = scrubSecretsFromString(input.diagnostic ?? "").slice(0, 240) || null;
  return {
    contractVersion: ORCHESTRATION_EVIDENCE_CONTRACT_V1,
    id: input.id,
    jobId: input.jobId,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    kind: input.kind,
    source: "executor",
    verification: "verified",
    createdAt: input.createdAt,
    artifactRef,
    diagnostic,
  };
}

export class OrchestrationEvidenceStore {
  private readonly records = new Map<string, OrchestrationEvidenceRecord>();

  register(record: OrchestrationEvidenceRecord): void {
    if (this.records.has(record.id)) {
      throw new SupervisorContractError("Duplicate evidence id.");
    }
    this.records.set(record.id, record);
  }

  rehydrate(record: OrchestrationEvidenceRecord): void {
    const existing = this.records.get(record.id);
    if (existing) {
      if (
        existing.assignmentId !== record.assignmentId ||
        existing.agentId !== record.agentId ||
        existing.jobId !== record.jobId ||
        existing.kind !== record.kind
      ) {
        throw new SupervisorContractError("Conflicting persisted evidence id.");
      }
      return;
    }
    this.records.set(record.id, record);
  }

  get(id: string): OrchestrationEvidenceRecord | null {
    return this.records.get(id) ?? null;
  }

  listForAssignment(assignmentId: string): OrchestrationEvidenceRecord[] {
    return [...this.records.values()].filter((row) => row.assignmentId === assignmentId);
  }

  assertCompletionEvidence(
    assignmentId: string,
    agentId: string,
    jobId: string,
    evidenceIds: readonly string[],
  ): readonly string[] {
    if (!evidenceIds.length) {
      throw new SupervisorContractError("Terminal success requires evidence references.");
    }
    const unique = [...new Set(evidenceIds)];
    if (unique.length !== evidenceIds.length) {
      throw new SupervisorContractError("Duplicate evidence ids in completion request.");
    }
    let workCompleted = 0;
    for (const id of unique) {
      const record = this.records.get(id);
      if (!record) {
        throw new SupervisorContractError("Completion references unknown evidence.");
      }
      if (record.assignmentId !== assignmentId || record.agentId !== agentId || record.jobId !== jobId) {
        throw new SupervisorContractError("Evidence is not owned by this assignment.");
      }
      if (record.verification !== "verified" || record.source !== "executor") {
        throw new SupervisorContractError("Evidence is not verified for completion.");
      }
      if (record.kind === "work_completed") workCompleted += 1;
    }
    if (workCompleted < 1) {
      throw new SupervisorContractError("Completion requires at least one verified work_completed evidence record.");
    }
    return unique;
  }
}
