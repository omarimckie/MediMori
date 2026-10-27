import { sanitizeEvidence } from "./sanitize";
import type { MarketingIncidentEventRecord, MarketingIncidentRecord } from "./types";

export type IncidentApiRecord = Omit<MarketingIncidentRecord, "evidence"> & {
  evidence: Record<string, unknown>;
};

export function serializeIncidentForApi(incident: MarketingIncidentRecord): IncidentApiRecord {
  return {
    ...incident,
    evidence: sanitizeEvidence(incident.evidence ?? {}),
  };
}

export function serializeIncidentEventForApi(
  event: MarketingIncidentEventRecord,
): MarketingIncidentEventRecord {
  return {
    ...event,
    payload: sanitizeEvidence(event.payload ?? {}),
  };
}
