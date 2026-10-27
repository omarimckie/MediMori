export const CURSOR_DISPATCH_RECOVERY_AUDIT_CONTRACT_V1 =
  "central-agent-manager-cursor-recovery-audit/v1" as const;

export const cursorDispatchRecoveryAuditActions = [
  "confirm_verified_external_ids",
  "fail_external_dispatch",
  "cancel_external_dispatch",
] as const;

export type CursorDispatchRecoveryAuditAction = (typeof cursorDispatchRecoveryAuditActions)[number];

export type CursorDispatchRecoveryAuditRecord = {
  contractVersion: typeof CURSOR_DISPATCH_RECOVERY_AUDIT_CONTRACT_V1;
  id: string;
  action: CursorDispatchRecoveryAuditAction;
  recordedAt: string;
  ownerUsername: string;
  assignmentId: string;
  jobId: string;
  reason?: string;
  cursorAgentId?: string;
  cursorRunId?: string;
};

const AUDIT_ID = /^[\w-]{8,80}$/;

export function validateCursorDispatchRecoveryAuditRecord(value: unknown): CursorDispatchRecoveryAuditRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid cursor dispatch recovery audit record.");
  }
  const row = value as CursorDispatchRecoveryAuditRecord;
  if (row.contractVersion !== CURSOR_DISPATCH_RECOVERY_AUDIT_CONTRACT_V1) {
    throw new Error("Invalid cursor dispatch recovery audit contract version.");
  }
  if (!cursorDispatchRecoveryAuditActions.includes(row.action)) {
    throw new Error("Invalid cursor dispatch recovery audit action.");
  }
  if (typeof row.id !== "string" || !AUDIT_ID.test(row.id)) {
    throw new Error("Invalid cursor dispatch recovery audit id.");
  }
  if (typeof row.recordedAt !== "string" || !row.recordedAt.trim()) {
    throw new Error("Invalid cursor dispatch recovery audit timestamp.");
  }
  if (typeof row.ownerUsername !== "string" || !row.ownerUsername.trim() || row.ownerUsername.length > 80) {
    throw new Error("Invalid cursor dispatch recovery audit owner.");
  }
  if (typeof row.assignmentId !== "string" || !row.assignmentId.trim()) {
    throw new Error("Invalid cursor dispatch recovery audit assignment id.");
  }
  if (typeof row.jobId !== "string" || !row.jobId.trim()) {
    throw new Error("Invalid cursor dispatch recovery audit job id.");
  }
  if (row.reason !== undefined) {
    if (typeof row.reason !== "string" || row.reason.length > 240) {
      throw new Error("Invalid cursor dispatch recovery audit reason.");
    }
  }
  if (row.cursorAgentId !== undefined) {
    if (typeof row.cursorAgentId !== "string" || row.cursorAgentId.length > 128) {
      throw new Error("Invalid cursor dispatch recovery audit cursor agent id.");
    }
  }
  if (row.cursorRunId !== undefined) {
    if (typeof row.cursorRunId !== "string" || row.cursorRunId.length > 128) {
      throw new Error("Invalid cursor dispatch recovery audit cursor run id.");
    }
  }
  return row;
}

export function appendRecoveryAuditRecord(
  existing: readonly CursorDispatchRecoveryAuditRecord[] | undefined,
  record: CursorDispatchRecoveryAuditRecord,
): readonly CursorDispatchRecoveryAuditRecord[] {
  validateCursorDispatchRecoveryAuditRecord(record);
  const next = [...(existing ?? []), record];
  if (next.length > 32) {
    throw new Error("Cursor dispatch recovery audit history is full.");
  }
  return next;
}
