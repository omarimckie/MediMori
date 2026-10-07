import type {
  MarketingIncidentRecord,
  MarketingIncidentSeverity,
  MarketingIncidentStatus,
  MarketingIncidentType,
  PermittedAction,
  ResolutionType,
  RetrySafety,
} from "./types";

export type RecordIncidentInput = {
  incidentType: MarketingIncidentType | string;
  status?: MarketingIncidentStatus | string;
  severity: MarketingIncidentSeverity | string;
  sourceOperation: string;
  dedupeKey: string;
  errorClass: string;
  errorMessage: string;
  retrySafety: RetrySafety | string;
  permittedActions: readonly string[];
  humanApprovalRequired?: boolean;
  evidence?: Record<string, unknown>;
  occurredAt?: string;
  detectedAt?: string;
  contentId?: string | null;
  publicationId?: string | null;
  platform?: string | null;
  provider?: string | null;
  batchId?: string | null;
  finalizeKey?: string | null;
};

export type RecordIncidentOptions = {
  reopenIfResolved?: boolean;
};

export type RecordIncidentOutcome = "created" | "occurrence" | "reopened";

export type RecordIncidentResult = {
  outcome: RecordIncidentOutcome;
  incident: MarketingIncidentRecord;
};

export type ResolveIncidentInput = {
  resolutionType: ResolutionType | string;
  resolutionSummary: string;
  actor?: string;
  incidentVersion?: number;
};
