import type { MockSpecialistAssignmentView } from "../mock-specialist-agent";

export type CursorBridgeConsumerPort = {
  readonly agentId: string;
  claim(input?: { jobId?: string; idempotencyKey?: string }): Promise<{
    status: number;
    assignment: MockSpecialistAssignmentView | null;
    externalRefs?: { cursorAgentId?: string; cursorRunId?: string; correlationKey?: string };
  }>;
  beginExternalDispatch(assignment: MockSpecialistAssignmentView, dispatchOwnerId: string): Promise<number>;
  markExternalDispatchOutcomeUnknown(assignment: MockSpecialistAssignmentView): Promise<number>;
  markExternalDispatchFailed(assignment: MockSpecialistAssignmentView, reason: string): Promise<number>;
  escalateExternalDispatchRecovery(assignment: MockSpecialistAssignmentView, reason: string): Promise<number>;
  correlateExternal(
    assignment: MockSpecialistAssignmentView,
    externalRefs: { cursorAgentId?: string; cursorRunId?: string },
  ): Promise<number>;
  heartbeat(
    assignment: MockSpecialistAssignmentView,
    progress?: { diagnostic?: string; artifactRef?: string },
  ): Promise<number>;
  submitEvidence(
    assignment: MockSpecialistAssignmentView,
    evidence: { id: string; kind: "work_completed" | "progress_note"; artifactRef?: string; diagnostic?: string },
  ): Promise<number>;
  complete(
    assignment: MockSpecialistAssignmentView,
    evidenceIds: readonly string[],
    idempotencyKey?: string,
  ): Promise<{ status: number; jobState?: string }>;
  fail(assignment: MockSpecialistAssignmentView, reason: string, idempotencyKey?: string): Promise<number>;
};
