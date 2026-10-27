/**
 * Correlation metadata for external runtimes (Cursor SDK, MediMori engineering).
 * These fields are never execution authorization and must not substitute for
 * engineering owner gates, worker leases, or CAM approval bindings.
 */

export const EXTERNAL_EXECUTION_REFERENCE_KEYS = [
  "correlationKey",
  "engineeringTaskId",
  "engineeringRunId",
  "cursorAgentId",
  "cursorRunId",
] as const;

export type ExternalExecutionReferenceKey = (typeof EXTERNAL_EXECUTION_REFERENCE_KEYS)[number];

export type ExternalExecutionReferences = {
  correlationKey?: string;
  engineeringTaskId?: string;
  engineeringRunId?: string;
  cursorAgentId?: string;
  cursorRunId?: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORRELATION_KEY = /^[\w.:+-]{1,128}$/;

const CURSOR_ID = /^[A-Za-z0-9_-]{1,128}$/;

const SECRET_LIKE = /(sk_[A-Za-z0-9]{10,}|Bearer\s|postgres(ql)?:\/\/)/i;

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid external execution references.");
  }
  return value as Record<string, unknown>;
}

function readBoundedToken(
  record: Record<string, unknown>,
  key: ExternalExecutionReferenceKey,
  pattern: RegExp,
  maxLength: number,
): string | undefined {
  const raw = record[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`Invalid external reference field: ${key}.`);
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLength || !pattern.test(trimmed)) {
    throw new Error(`Invalid external reference field: ${key}.`);
  }
  if (SECRET_LIKE.test(trimmed)) {
    throw new Error(`Rejected secret-like external reference field: ${key}.`);
  }
  return trimmed;
}

/** Strict validation for persistence and enqueue paths. Returns undefined when absent or empty. */
export function validateExternalExecutionReferences(
  value: unknown,
): ExternalExecutionReferences | undefined {
  if (value === undefined || value === null) return undefined;
  const record = assertPlainObject(value);
  for (const key of Object.keys(record)) {
    if (!(EXTERNAL_EXECUTION_REFERENCE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unknown external reference field: ${key}.`);
    }
  }
  const out: ExternalExecutionReferences = {};
  const correlationKey = readBoundedToken(record, "correlationKey", CORRELATION_KEY, 128);
  const engineeringTaskId = readBoundedToken(record, "engineeringTaskId", UUID, 36);
  const engineeringRunId = readBoundedToken(record, "engineeringRunId", UUID, 36);
  const cursorAgentId = readBoundedToken(record, "cursorAgentId", CURSOR_ID, 128);
  const cursorRunId = readBoundedToken(record, "cursorRunId", CURSOR_ID, 128);
  if (correlationKey) out.correlationKey = correlationKey;
  if (engineeringTaskId) out.engineeringTaskId = engineeringTaskId;
  if (engineeringRunId) out.engineeringRunId = engineeringRunId;
  if (cursorAgentId) out.cursorAgentId = cursorAgentId;
  if (cursorRunId) out.cursorRunId = cursorRunId;
  return Object.keys(out).length ? out : undefined;
}

/** Owner-facing projection: validated copy only (no extra fields). */
export function projectExternalExecutionReferences(
  value: ExternalExecutionReferences | undefined | null,
): ExternalExecutionReferences | null {
  if (!value) return null;
  try {
    return validateExternalExecutionReferences(value) ?? null;
  } catch {
    return null;
  }
}

export function serializeExternalExecutionReferences(
  value: ExternalExecutionReferences | undefined,
): ExternalExecutionReferences | undefined {
  return validateExternalExecutionReferences(value);
}

const CURSOR_DISPATCH_KEYS = ["cursorAgentId", "cursorRunId"] as const;

/** Agent consumer correlate_external: cursor dispatch ids only. */
export function validateCursorDispatchCorrelationPatch(value: unknown): ExternalExecutionReferences {
  if (value === undefined || value === null) {
    throw new Error("Cursor dispatch correlation payload is required.");
  }
  const record = assertPlainObject(value);
  for (const key of Object.keys(record)) {
    if (!(CURSOR_DISPATCH_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unknown cursor dispatch correlation field: ${key}.`);
    }
  }
  const validated = validateExternalExecutionReferences(record);
  if (!validated?.cursorAgentId && !validated?.cursorRunId) {
    throw new Error("At least one cursor dispatch id is required.");
  }
  return validated;
}

export function hasConfirmedCursorExternalIds(
  refs: ExternalExecutionReferences | undefined,
): boolean {
  return Boolean(refs?.cursorAgentId && refs?.cursorRunId);
}

export function mergeExternalExecutionReferences(
  existing: ExternalExecutionReferences | undefined,
  patch: ExternalExecutionReferences,
): ExternalExecutionReferences {
  if (existing?.cursorAgentId && patch.cursorAgentId && existing.cursorAgentId !== patch.cursorAgentId) {
    throw new Error("Cursor agent id conflict: dispatch already recorded for this assignment.");
  }
  if (existing?.cursorRunId && patch.cursorRunId && existing.cursorRunId !== patch.cursorRunId) {
    throw new Error("Cursor run id conflict: dispatch already recorded for this assignment.");
  }
  const merged: Record<string, string> = {};
  if (existing?.correlationKey) merged.correlationKey = existing.correlationKey;
  if (existing?.engineeringTaskId) merged.engineeringTaskId = existing.engineeringTaskId;
  if (existing?.engineeringRunId) merged.engineeringRunId = existing.engineeringRunId;
  const cursorAgentId = patch.cursorAgentId ?? existing?.cursorAgentId;
  const cursorRunId = patch.cursorRunId ?? existing?.cursorRunId;
  if (cursorAgentId) merged.cursorAgentId = cursorAgentId;
  if (cursorRunId) merged.cursorRunId = cursorRunId;
  return validateExternalExecutionReferences(merged)!;
}
