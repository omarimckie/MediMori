/**
 * Heuristic sanitization for incident evidence and errors.
 * Trust boundary: callers must not rely on this as cryptographic redaction.
 */

export const MAX_SANITIZED_ERROR_LENGTH = 2_000;
export const MAX_EVIDENCE_JSON_BYTES = 8_192;
export const MAX_EVIDENCE_DEPTH = 6;
export const MAX_EVIDENCE_ARRAY_LENGTH = 50;
export const MAX_EVIDENCE_STRING_LENGTH = 1_000;

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|session|password|secret|token|api[_-]?key|bearer|vapid|cron[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key)/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\bauthorization:\s*[^\s]+/gi,
  /\bAuthorization:\s*[^\s]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bsk-[A-Za-z0-9]{10,}\b/g,
  /\bCRON_SECRET=[^\s&]+/gi,
  /\baccess_token=[A-Za-z0-9._-]+/gi,
  /\bEAA[A-Za-z0-9]{20,}\b/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /\bCookie:\s*[^\n]+/gi,
  /\bsession=[^;\s]+/gi,
];

export const REDACTED_PLACEHOLDER = "[REDACTED]";

export function redactSensitiveString(input: string): string {
  let out = input;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED_PLACEHOLDER);
  }
  return out.slice(0, MAX_SANITIZED_ERROR_LENGTH);
}

export function sanitizeErrorMessage(input: string): string {
  return redactSensitiveString(String(input ?? "").trim() || "Unknown error");
}

type SanitizeContext = {
  depth: number;
  bytes: number;
  seen: WeakSet<object>;
};

function estimateBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return MAX_EVIDENCE_JSON_BYTES + 1;
  }
}

function sanitizeValue(value: unknown, ctx: SanitizeContext, key?: string): unknown {
  if (ctx.bytes >= MAX_EVIDENCE_JSON_BYTES) {
    return REDACTED_PLACEHOLDER;
  }
  if (value == null) return value;

  if (typeof value === "string") {
    const redacted = redactSensitiveString(value);
    const trimmed = redacted.slice(0, MAX_EVIDENCE_STRING_LENGTH);
    ctx.bytes += trimmed.length;
    return trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    ctx.bytes += 8;
    return value;
  }

  if (Array.isArray(value)) {
    if (ctx.depth >= MAX_EVIDENCE_DEPTH) return REDACTED_PLACEHOLDER;
    const next = { ...ctx, depth: ctx.depth + 1 };
    return value
      .slice(0, MAX_EVIDENCE_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, next));
  }

  if (typeof value === "object") {
    if (ctx.seen.has(value as object)) return REDACTED_PLACEHOLDER;
    ctx.seen.add(value as object);
    if (ctx.depth >= MAX_EVIDENCE_DEPTH) return REDACTED_PLACEHOLDER;
    const next = { ...ctx, depth: ctx.depth + 1 };
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(childKey)) {
        out[childKey] = REDACTED_PLACEHOLDER;
        ctx.bytes += REDACTED_PLACEHOLDER.length;
        continue;
      }
      out[childKey] = sanitizeValue(childValue, next, childKey);
    }
    return out;
  }

  return REDACTED_PLACEHOLDER;
}

/** Allowlisted top-level evidence keys preferred for correlation (still sanitized). */
export const PREFERRED_EVIDENCE_KEYS = new Set([
  "batchId",
  "finalizeKey",
  "attemptCount",
  "ambiguityState",
  "httpStatus",
  "publicationStatus",
  "contentStatus",
  "providerCreationIdPresent",
  "externalIdPresent",
  "dedupeContext",
]);

export function sanitizeEvidence(input: Record<string, unknown>): Record<string, unknown> {
  const ctx: SanitizeContext = { depth: 0, bytes: 0, seen: new WeakSet() };
  const sanitized = sanitizeValue(input, ctx) as Record<string, unknown>;
  const size = estimateBytes(sanitized);
  if (size > MAX_EVIDENCE_JSON_BYTES) {
    return { truncated: true, reason: "evidence_size_exceeded" };
  }
  return sanitized;
}

export function sanitizeEventPayload(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeEvidence(input);
}
