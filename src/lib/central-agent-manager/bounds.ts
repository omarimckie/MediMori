import type {
  ActiveAgent,
  AgentState,
  EvidenceRef,
  PendingApproval,
  ProjectTaskSummary,
  TaskBlocker,
} from "./types";
import { agentStates } from "./types";

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const iso =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function boundedText(value: unknown, max = 240): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return "";
  return trimmed;
}

export function boundedId(value: unknown): string {
  const text = boundedText(value, 64);
  if (!text || text.length > 64) return "";
  if (uuid.test(text)) return text;
  if (/^[\w-]{1,64}$/.test(text)) return text;
  return "";
}

export function boundedIsoTimestamp(value: unknown): string | null {
  const text = boundedText(value, 40);
  if (!text || !iso.test(text)) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function boundedAdminHref(value: unknown): string | undefined {
  const text = boundedText(value, 240);
  if (!text.startsWith("/admin/")) return undefined;
  if (text.includes("..") || text.includes("//")) return undefined;
  return text;
}

export function sanitizeAgentState(value: unknown): AgentState {
  if (typeof value === "string" && (agentStates as readonly string[]).includes(value)) {
    return value as AgentState;
  }
  return "unknown";
}

export function sanitizeActiveAgents(raw: unknown, limit = 12): ActiveAgent[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = boundedId(record.id);
    const label = boundedText(record.label, 120);
    if (!id || !label) return [];
    return [{ id, label, state: sanitizeAgentState(record.state) }];
  });
}

export function sanitizeBlockers(raw: unknown, limit = 6): TaskBlocker[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = boundedId(record.id);
    const summary = boundedText(record.summary, 400);
    if (!id || !summary) return [];
    const severity = record.severity;
    const normalized =
      severity === "info" || severity === "warning" || severity === "critical"
        ? severity
        : "warning";
    return [{ id, summary, severity: normalized }];
  });
}

export function sanitizeTasks(raw: unknown, limit = 20): ProjectTaskSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = boundedId(record.id);
    const title = boundedText(record.title, 400);
    const status = boundedText(record.status, 64);
    if (!id || !title || !status) return [];
    return [
      {
        id,
        title,
        status,
        blockers: sanitizeBlockers(record.blockers, 6),
      },
    ];
  });
}

export function sanitizePendingApprovals(raw: unknown, limit = 12): PendingApproval[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = boundedId(record.id);
    const summary = boundedText(record.summary, 400);
    if (!id || !summary) return [];
    const requestedAt = boundedIsoTimestamp(record.requestedAt) ?? undefined;
    return [{ id, summary, ...(requestedAt ? { requestedAt } : {}) }];
  });
}

export function sanitizeEvidence(raw: unknown, limit = 8): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const kind = boundedText(record.kind, 64);
    const label = boundedText(record.label, 120);
    if (!kind || !label) return [];
    const href = boundedAdminHref(record.href);
    return href ? [{ kind, label, href }] : [{ kind, label }];
  });
}
