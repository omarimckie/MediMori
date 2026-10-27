import {
  sanitizeActiveAgents,
  sanitizeEvidence,
  sanitizePendingApprovals,
  sanitizeTasks,
} from "./bounds";
import type {
  ActiveAgent,
  EvidenceRef,
  PendingApproval,
  ProjectTaskSummary,
} from "./types";

export const MAX_REMOTE_JSON_BYTES = 256 * 1024;

const ALLOWED_ROOT_KEYS = new Set([
  "activeAgents",
  "tasks",
  "pendingApprovals",
  "lastSuccessfulUpdate",
  "evidence",
]);

export function parseBoundedRemoteJson(text: string): unknown | null {
  if (text.length > MAX_REMOTE_JSON_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export type NormalizedRemoteStatusPayload = {
  activeAgents: ActiveAgent[];
  tasks: ProjectTaskSummary[];
  pendingApprovals: PendingApproval[];
  lastSuccessfulUpdate: unknown;
  evidence: EvidenceRef[];
};

export function normalizeRemoteStatusPayload(raw: unknown): NormalizedRemoteStatusPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length > ALLOWED_ROOT_KEYS.size + 4) return null;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) return null;
  }

  return {
    activeAgents: sanitizeActiveAgents(record.activeAgents),
    tasks: sanitizeTasks(record.tasks),
    pendingApprovals: sanitizePendingApprovals(record.pendingApprovals),
    lastSuccessfulUpdate: record.lastSuccessfulUpdate,
    evidence: sanitizeEvidence(record.evidence),
  };
}
