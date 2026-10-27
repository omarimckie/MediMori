/**
 * Closed operational incident vocabulary (reuse notification names where they align).
 * User-input validation failures (e.g. unsupported image dimensions) are NOT incident types.
 */
export const MARKETING_INCIDENT_TYPES = [
  "publication_failed",
  "partial_publication_failure",
  "publication_ambiguous",
  "publication_overdue",
  "publication_stuck_processing",
  "publication_recovery_required",
  "credential_warning",
  "dispatcher_warning",
  "smart_upload_caption_failed",
  "smart_upload_finalize_failed",
  "smart_upload_operational_failed",
] as const;

export type MarketingIncidentType = (typeof MARKETING_INCIDENT_TYPES)[number];

export const MARKETING_INCIDENT_STATUSES = [
  "open",
  "investigating",
  "action_required",
  "blocked",
  "resolved",
] as const;

export type MarketingIncidentStatus = (typeof MARKETING_INCIDENT_STATUSES)[number];

export const MARKETING_INCIDENT_SEVERITIES = ["info", "warning", "error"] as const;

export type MarketingIncidentSeverity = (typeof MARKETING_INCIDENT_SEVERITIES)[number];

export const RETRY_SAFETY_VALUES = [
  "safe_automatic",
  "safe_manual",
  "unsafe_duplicate_risk",
  "unknown_requires_verification",
  "not_applicable",
] as const;

export type RetrySafety = (typeof RETRY_SAFETY_VALUES)[number];

/**
 * Closed authority envelope — unknown identifiers fail closed at parse time.
 * Marketing records envelopes derived elsewhere; this module does not infer retry safety from publications.
 */
export const PERMITTED_ACTIONS = [
  "investigate_read_only",
  "notify_owner",
  "admin_retry_publication",
  "cron_retry_publication",
  "schedule_reschedule",
  "reconcile_meta_read_only",
  "owner_approve_remediation",
  "no_op",
] as const;

export type PermittedAction = (typeof PERMITTED_ACTIONS)[number];

export const RESOLUTION_TYPES = [
  "auto_recovered",
  "owner_resolved",
  "superseded",
  "false_positive",
] as const;

export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export const MARKETING_INCIDENT_EVENT_TYPES = [
  "incident_created",
  "occurrence_recorded",
  "status_changed",
  "incident_resolved",
  "incident_reopened",
] as const;

export type MarketingIncidentEventType = (typeof MARKETING_INCIDENT_EVENT_TYPES)[number];

export const MARKETING_INCIDENT_SOURCE_SYSTEM = "marketing_autopilot";

export const MARKETING_INCIDENT_SCHEMA_VERSION = 1;

export type MarketingIncidentRecord = {
  id: string;
  schemaVersion: number;
  incidentVersion: number;
  incidentType: MarketingIncidentType;
  status: MarketingIncidentStatus;
  severity: MarketingIncidentSeverity;
  sourceSystem: string;
  sourceOperation: string;
  occurredAt: string;
  detectedAt: string;
  contentId: string | null;
  publicationId: string | null;
  platform: string | null;
  provider: string | null;
  batchId: string | null;
  finalizeKey: string | null;
  dedupeKey: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  errorClass: string;
  sanitizedError: string;
  retrySafety: RetrySafety;
  permittedActions: PermittedAction[];
  humanApprovalRequired: boolean;
  evidence: Record<string, unknown>;
  resolutionType: ResolutionType | null;
  resolutionSummary: string | null;
  resolvedAt: string | null;
  agentWorkCorrelationId: string;
  agentWorkLastSubmittedAt: string | null;
  agentWorkLastSubmitError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingIncidentEventRecord = {
  id: string;
  incidentId: string;
  eventType: MarketingIncidentEventType;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
