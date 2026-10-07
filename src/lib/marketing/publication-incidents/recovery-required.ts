import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import { recordIncident } from "../incidents/record";
import type { RecordIncidentResult } from "../incidents/record-types";
import { logMarketing } from "../logger";
import { sanitizeErrorMessage } from "../incidents/sanitize";
import type { MarketingIncidentRecord } from "../incidents/types";
import {
  INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
  isInstagramProviderMediaRecoveryRequired,
} from "../publication-recovery-guard";
import type { MarketingPublication } from "../types";
import { publicationRecoveryRequiredIncidentDedupeKey } from "./dedupe-keys";
import { publicationIncidentEvidence } from "./evidence";
import {
  notifyPublicationRecoveryRequiredWithDeps,
  type PublicationRecoveryNotifyDeps,
} from "./recovery-notify";

const RECOVERY_PERMITTED_ACTIONS = [
  "investigate_read_only",
  "owner_approve_remediation",
] as const;

function recoveryIncidentInput(
  publication: MarketingPublication,
  sourceOperation: string,
) {
  return {
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
  };
}

export async function recordPublicationRecoveryRequiredIncidentResult(
  publication: MarketingPublication,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
): Promise<RecordIncidentResult | null> {
  if (!isInstagramProviderMediaRecoveryRequired(publication)) {
    return null;
  }
  const repo = repository ?? getMarketingIncidentRepository();
  try {
    return await recordIncident(repo, recoveryIncidentInput(publication, sourceOperation), {
      reopenIfResolved: true,
    });
  } catch (error) {
    logMarketing({
      operation: "marketing_incident_record",
      contentId: publication.contentId,
      success: false,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : "incident_record_failed",
      ),
    });
    return null;
  }
}

export async function recordPublicationRecoveryRequiredIncident(
  publication: MarketingPublication,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
): Promise<MarketingIncidentRecord | null> {
  const result = await recordPublicationRecoveryRequiredIncidentResult(
    publication,
    sourceOperation,
    repository,
  );
  return result?.incident ?? null;
}

/**
 * Records/reobserves the recovery-required incident, then notifies when durable incident exists.
 * Does not change publication state or unblock guarded operations.
 */
export async function observePublicationRecoveryRequired(
  publication: MarketingPublication,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
  options?: {
    notifyRecovery?: typeof notifyPublicationRecoveryRequiredWithDeps;
    notifyRecoveryDeps?: PublicationRecoveryNotifyDeps;
  },
): Promise<MarketingIncidentRecord | null> {
  const result = await recordPublicationRecoveryRequiredIncidentResult(
    publication,
    sourceOperation,
    repository,
  );
  if (!result) {
    return null;
  }
  if (result.outcome === "created" || result.outcome === "reopened") {
    const notify = options?.notifyRecovery ?? notifyPublicationRecoveryRequiredWithDeps;
    await notify(publication, result.incident.id, options?.notifyRecoveryDeps);
  }
  return result.incident;
}
