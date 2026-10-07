import type { MarketingIncidentRepository } from "../incidents/repository";
import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import type { MarketingIncidentRecord } from "../incidents/types";
import type { MarketingPublication } from "../types";
import { publicationOverdueIncidentDedupeKey } from "./dedupe-keys";
import { publicationIncidentEvidence } from "./evidence";

const OVERDUE_PERMITTED_ACTIONS = ["investigate_read_only", "notify_owner"] as const;

export async function recordPublicationOverdueIncident(
  publication: MarketingPublication,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  return recordMarketingIncidentSafely(
    {
      incidentType: "publication_overdue",
      status: "open",
      severity: "warning",
      sourceOperation: "reliability_overdue",
      dedupeKey: publicationOverdueIncidentDedupeKey(publication.id),
      errorClass: "publication_overdue",
      errorMessage: "Scheduled publication is overdue and not yet published.",
      retrySafety: "not_applicable",
      permittedActions: [...OVERDUE_PERMITTED_ACTIONS],
      humanApprovalRequired: false,
      contentId: publication.contentId,
      publicationId: publication.id,
      platform: publication.platform,
      provider: publication.provider,
      evidence: publicationIncidentEvidence(publication, {
        scheduled_for: publication.scheduledFor,
        reliability_signal: "overdue",
      }),
    },
    { repository, reopenIfResolved: true },
  );
}
