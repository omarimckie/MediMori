import type { MarketingIncidentRepository } from "../incidents/repository";
import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import type { MarketingIncidentRecord } from "../incidents/types";
import { notifyPublicationAmbiguousOutcome } from "../publication-ambiguity/notify";
import type { MarketingPublication } from "../types";
import { publicationAmbiguousIncidentDedupeKey } from "./dedupe-keys";
import {
  parsePublicationErrorClass,
  publicationIncidentEvidence,
  publicationIncidentSanitizedError,
} from "./evidence";

const AMBIGUOUS_PERMITTED_ACTIONS = [
  "investigate_read_only",
  "owner_approve_remediation",
] as const;

export async function recordPublicationAmbiguousOutcomeIncident(
  publication: MarketingPublication,
  input?: { notifyDetail?: string; repository?: MarketingIncidentRepository },
): Promise<MarketingIncidentRecord | null> {
  const incident = await recordMarketingIncidentSafely(
    {
      incidentType: "publication_ambiguous",
      status: "action_required",
      severity: "error",
      sourceOperation: "publication_ambiguous_outcome",
      dedupeKey: publicationAmbiguousIncidentDedupeKey(publication.id),
      errorClass: parsePublicationErrorClass(publication.lastError),
      errorMessage: publicationIncidentSanitizedError(publication),
      retrySafety: "unknown_requires_verification",
      permittedActions: [...AMBIGUOUS_PERMITTED_ACTIONS],
      humanApprovalRequired: true,
      contentId: publication.contentId,
      publicationId: publication.id,
      platform: publication.platform,
      provider: publication.provider,
      evidence: publicationIncidentEvidence(publication),
    },
    { repository: input?.repository, reopenIfResolved: true },
  );

  await notifyPublicationAmbiguousOutcome(
    publication,
    input?.notifyDetail,
    incident?.id ?? null,
  );
  return incident;
}
