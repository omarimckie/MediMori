import {
  assertLegalIncidentReopen,
  assertLegalIncidentTransition,
} from "./lifecycle";
import type { MarketingIncidentRepository } from "./repository";
import { sanitizeErrorMessage, sanitizeEvidence, sanitizeEventPayload } from "./sanitize";
import {
  MARKETING_INCIDENT_SCHEMA_VERSION,
  MARKETING_INCIDENT_SOURCE_SYSTEM,
  type MarketingIncidentEventType,
  type MarketingIncidentRecord,
} from "./types";
import { IncidentDedupeResolvedError, IncidentVersionConflictError } from "./errors";
import type {
  RecordIncidentInput,
  RecordIncidentOptions,
  RecordIncidentResult,
} from "./record-types";
import {
  parseIncidentSeverity,
  parseIncidentStatus,
  parseIncidentType,
  parsePermittedActions,
  parseRetrySafety,
} from "./validate";

export type PreparedRecordIncident = {
  incidentType: ReturnType<typeof parseIncidentType>;
  status: ReturnType<typeof parseIncidentStatus>;
  severity: ReturnType<typeof parseIncidentSeverity>;
  retrySafety: ReturnType<typeof parseRetrySafety>;
  permittedActions: ReturnType<typeof parsePermittedActions>;
  sourceOperation: string;
  dedupeKey: string;
  errorClass: string;
  sanitizedError: string;
  occurredAt: string;
  detectedAt: string;
  humanApprovalRequired: boolean;
  evidence: Record<string, unknown>;
  contentId: string | null;
  publicationId: string | null;
  platform: string | null;
  provider: string | null;
  batchId: string | null;
  finalizeKey: string | null;
};

export function prepareRecordIncidentInput(
  input: RecordIncidentInput,
  detectedAt: string,
  occurredAt: string,
): PreparedRecordIncident {
  const evidence: Record<string, unknown> = { ...(input.evidence ?? {}) };
  if (input.batchId?.trim()) evidence.batchId = input.batchId.trim();
  if (input.finalizeKey?.trim()) evidence.finalizeKey = input.finalizeKey.trim();

  return {
    incidentType: parseIncidentType(String(input.incidentType)),
    status: input.status != null
      ? parseIncidentStatus(String(input.status))
      : parseIncidentStatus("open"),
    severity: parseIncidentSeverity(String(input.severity)),
    retrySafety: parseRetrySafety(String(input.retrySafety)),
    permittedActions: parsePermittedActions(input.permittedActions),
    sourceOperation: input.sourceOperation.trim() || "unknown_operation",
    dedupeKey: input.dedupeKey.trim(),
    errorClass: input.errorClass.trim() || "unknown_error",
    sanitizedError: sanitizeErrorMessage(input.errorMessage),
    occurredAt,
    detectedAt,
    humanApprovalRequired: Boolean(input.humanApprovalRequired),
    evidence: sanitizeEvidence(evidence),
    contentId: input.contentId ?? null,
    publicationId: input.publicationId ?? null,
    platform: input.platform ?? null,
    provider: input.provider ?? null,
    batchId: input.batchId?.trim() || null,
    finalizeKey: input.finalizeKey?.trim() || null,
  };
}

async function appendEvent(
  repo: MarketingIncidentRepository,
  incidentId: string,
  eventType: MarketingIncidentEventType,
  payload: Record<string, unknown>,
  actor = "system",
): Promise<void> {
  await repo.appendEvent({
    id: crypto.randomUUID(),
    incidentId,
    eventType,
    actor,
    payload: sanitizeEventPayload(payload),
  });
}

export async function executeRecordIncident(
  repo: MarketingIncidentRepository,
  prepared: PreparedRecordIncident,
  options: RecordIncidentOptions,
  hooks?: {
    insertNew?: () => Promise<MarketingIncidentRecord>;
    loadExclusive?: () => Promise<MarketingIncidentRecord | null>;
  },
): Promise<RecordIncidentResult> {
  const existing =
    hooks?.loadExclusive != null
      ? await hooks.loadExclusive()
      : await repo.findByDedupeKey(prepared.dedupeKey);

  if (!existing) {
    const incident =
      hooks?.insertNew != null
        ? await hooks.insertNew()
        : await repo.insertIncident({
            id: crypto.randomUUID(),
            schemaVersion: MARKETING_INCIDENT_SCHEMA_VERSION,
            incidentVersion: 1,
            incidentType: prepared.incidentType,
            status: prepared.status,
            severity: prepared.severity,
            sourceSystem: MARKETING_INCIDENT_SOURCE_SYSTEM,
            sourceOperation: prepared.sourceOperation,
            occurredAt: prepared.occurredAt,
            detectedAt: prepared.detectedAt,
            contentId: prepared.contentId,
            publicationId: prepared.publicationId,
            platform: prepared.platform,
            provider: prepared.provider,
            batchId: prepared.batchId,
            finalizeKey: prepared.finalizeKey,
            dedupeKey: prepared.dedupeKey,
            occurrenceCount: 1,
            firstSeenAt: prepared.detectedAt,
            lastSeenAt: prepared.detectedAt,
            errorClass: prepared.errorClass,
            sanitizedError: prepared.sanitizedError,
            retrySafety: prepared.retrySafety,
            permittedActions: prepared.permittedActions,
            humanApprovalRequired: prepared.humanApprovalRequired,
            evidence: prepared.evidence,
            resolutionType: null,
            resolutionSummary: null,
            resolvedAt: null,
            agentWorkCorrelationId: crypto.randomUUID(),
            agentWorkLastSubmittedAt: null,
            agentWorkLastSubmitError: null,
          });
    await appendEvent(repo, incident.id, "incident_created", {
      incidentType: prepared.incidentType,
      severity: prepared.severity,
      dedupeKey: prepared.dedupeKey,
    });
    return { outcome: "created", incident };
  }

  if (existing.status === "resolved") {
    if (!options.reopenIfResolved) {
      throw new IncidentDedupeResolvedError(prepared.dedupeKey, existing.id);
    }
    assertLegalIncidentReopen(existing.status);
    const updated =
      (await repo.updateIncident(existing.id, existing.incidentVersion, {
        status: "open",
        occurrenceCount: existing.occurrenceCount + 1,
        lastSeenAt: prepared.detectedAt,
        resolvedAt: null,
        resolutionType: null,
        resolutionSummary: null,
        sanitizedError: prepared.sanitizedError,
        errorClass: prepared.errorClass,
      })) ??
      (() => {
        throw new IncidentVersionConflictError(existing.id);
      })();
    await appendEvent(repo, updated.id, "incident_reopened", {
      previousResolvedAt: existing.resolvedAt,
      occurrenceCount: updated.occurrenceCount,
    });
    await appendEvent(repo, updated.id, "occurrence_recorded", {
      occurrenceCount: updated.occurrenceCount,
      lastSeenAt: updated.lastSeenAt,
    });
    return { outcome: "reopened", incident: updated };
  }

  const updated =
    (await repo.updateIncident(existing.id, existing.incidentVersion, {
      occurrenceCount: existing.occurrenceCount + 1,
      lastSeenAt: prepared.detectedAt,
    })) ??
    (() => {
      throw new IncidentVersionConflictError(existing.id);
    })();
  await appendEvent(repo, updated.id, "occurrence_recorded", {
    occurrenceCount: updated.occurrenceCount,
    lastSeenAt: updated.lastSeenAt,
  });
  return { outcome: "occurrence", incident: updated };
}
