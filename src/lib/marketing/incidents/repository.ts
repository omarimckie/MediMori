import type {
  MarketingIncidentEventRecord,
  MarketingIncidentEventType,
  MarketingIncidentRecord,
} from "./types";

export type InsertIncidentInput = Omit<
  MarketingIncidentRecord,
  "createdAt" | "updatedAt"
> & {
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateIncidentPatch = Partial<
  Pick<
    MarketingIncidentRecord,
    | "status"
    | "severity"
    | "incidentVersion"
    | "occurrenceCount"
    | "firstSeenAt"
    | "lastSeenAt"
    | "sanitizedError"
    | "errorClass"
    | "evidence"
    | "resolutionType"
    | "resolutionSummary"
    | "resolvedAt"
    | "agentWorkLastSubmittedAt"
    | "agentWorkLastSubmitError"
  >
>;

export interface MarketingIncidentRepository {
  findByDedupeKey(dedupeKey: string): Promise<MarketingIncidentRecord | null>;
  findById(id: string): Promise<MarketingIncidentRecord | null>;
  insertIncident(input: InsertIncidentInput): Promise<MarketingIncidentRecord>;
  updateIncident(
    id: string,
    expectedVersion: number,
    patch: UpdateIncidentPatch,
  ): Promise<MarketingIncidentRecord | null>;
  appendEvent(input: {
    id: string;
    incidentId: string;
    eventType: MarketingIncidentEventType;
    actor: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<MarketingIncidentEventRecord>;
  listEvents(incidentId: string): Promise<MarketingIncidentEventRecord[]>;
}
