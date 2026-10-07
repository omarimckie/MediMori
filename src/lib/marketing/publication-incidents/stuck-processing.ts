import type { MarketingIncidentRepository } from "../incidents/repository";
import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import type { MarketingIncidentRecord } from "../incidents/types";
import type { MarketingPublication } from "../types";
import { publicationStuckProcessingIncidentDedupeKey } from "./dedupe-keys";
import {
  parsePublicationErrorClass,
  publicationIncidentEvidence,
  publicationIncidentSanitizedError,
} from "./evidence";

const STUCK_PERMITTED_ACTIONS = [
  "investigate_read_only",
  "owner_approve_remediation",
] as const;

export async function recordPublicationStuckProcessingIncident(
  publication: MarketingPublication,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  return recordMarketingIncidentSafely(
    {
      incidentType: "publication_stuck_processing",
      status: "action_required",
      severity: "error",
      sourceOperation: "reliability_stuck_processing",
      dedupeKey: publicationStuckProcessingIncidentDedupeKey(publication.id),
      errorClass: parsePublicationErrorClass(publication.lastError),
      errorMessage: publicationIncidentSanitizedError(publication),
      retrySafety: "unknown_requires_verification",
      permittedActions: [...STUCK_PERMITTED_ACTIONS],
      humanApprovalRequired: true,
      contentId: publication.contentId,
      publicationId: publication.id,
      platform: publication.platform,
      provider: publication.provider,
      evidence: publicationIncidentEvidence(publication, {
        reliability_signal: "stuck_processing",
      }),
    },
    { repository, reopenIfResolved: true },
  );
}
