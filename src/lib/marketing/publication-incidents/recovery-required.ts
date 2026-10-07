import type { MarketingIncidentRepository } from "../incidents/repository";
import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import type { MarketingIncidentRecord } from "../incidents/types";
import {
  INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
  isInstagramProviderMediaRecoveryRequired,
} from "../publication-recovery-guard";
import type { MarketingPublication } from "../types";
import { publicationRecoveryRequiredIncidentDedupeKey } from "./dedupe-keys";
import { publicationIncidentEvidence } from "./evidence";

const RECOVERY_PERMITTED_ACTIONS = [
  "investigate_read_only",
  "owner_approve_remediation",
] as const;

export async function recordPublicationRecoveryRequiredIncident(
  publication: MarketingPublication,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  if (!isInstagramProviderMediaRecoveryRequired(publication)) {
    return null;
  }
  return recordMarketingIncidentSafely(
    {
      incidentType: "publication_recovery_required",
      status: "action_required",
      severity: "error",
      sourceOperation,
      dedupeKey: publicationRecoveryRequiredIncidentDedupeKey(publication.id),
      errorClass: "publication_recovery_required",
      errorMessage: INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
      retrySafety: "unsafe_duplicate_risk",
      permittedActions: [...RECOVERY_PERMITTED_ACTIONS],
      humanApprovalRequired: true,
      contentId: publication.contentId,
      publicationId: publication.id,
      platform: publication.platform,
      provider: publication.provider,
      evidence: publicationIncidentEvidence(publication, {
        recovery_guard: "instagram_provider_media",
      }),
    },
    { repository },
  );
}
