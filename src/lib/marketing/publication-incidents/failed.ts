import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import { recordIncident } from "../incidents/record";
import type { RecordIncidentResult } from "../incidents/record-types";
import { logMarketing } from "../logger";
import { publicationRetryBlockedReason } from "../publication-ambiguity/guards";
import { sanitizeErrorMessage } from "../incidents/sanitize";
import type { MarketingPublication } from "../types";
import { publicationFailedIncidentDedupeKey } from "./dedupe-keys";
import {
  parsePublicationErrorClass,
  publicationIncidentEvidence,
  publicationIncidentSanitizedError,
} from "./evidence";
import { evaluatePublicationFailedCapture } from "./publication-failed-eligibility";

function permittedActionsForFailedPublication(
  publication: MarketingPublication,
): readonly string[] {
  const actions = ["investigate_read_only", "notify_owner"] as const;
  if (!publicationRetryBlockedReason(publication)) {
    return [...actions, "admin_retry_publication"];
  }
  return [...actions];
}

function retrySafetyForFailedPublication(
  publication: MarketingPublication,
): "safe_manual" | "not_applicable" {
  if (publicationRetryBlockedReason(publication)) {
    return "not_applicable";
  }
  return "safe_manual";
}

export async function recordPublicationFailedIncidentResult(
  publication: MarketingPublication,
  sourceOperation: string,
  repository?: MarketingIncidentRepository,
): Promise<RecordIncidentResult | null> {
  const decision = evaluatePublicationFailedCapture(publication);
  if (!decision.capture) {
    return null;
  }
  const repo = repository ?? getMarketingIncidentRepository();
  const errorClass = parsePublicationErrorClass(publication.lastError);
  try {
    return await recordIncident(
      repo,
      {
        incidentType: "publication_failed",
        status: "action_required",
        severity: "error",
        sourceOperation,
        dedupeKey: publicationFailedIncidentDedupeKey(publication.id),
        errorClass,
        errorMessage: publicationIncidentSanitizedError(publication),
        retrySafety: retrySafetyForFailedPublication(publication),
        permittedActions: permittedActionsForFailedPublication(publication),
        humanApprovalRequired: false,
        contentId: publication.contentId,
        publicationId: publication.id,
        platform: publication.platform,
        provider: publication.provider,
        evidence: publicationIncidentEvidence(publication, {
          capture_reason: "actionable_terminal_failure",
        }),
      },
      { reopenIfResolved: true },
    );
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
