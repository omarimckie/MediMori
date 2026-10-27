import { isPublicationOverdue } from "../reliability/detect";
import { isInstagramProviderMediaRecoveryRequired } from "../publication-recovery-guard";
import { isPublicationAmbiguityBlocked } from "../publication-ambiguity/types";
import {
  isPersistedProviderCreationId,
  isProviderInflightMarker,
} from "../publication-ambiguity/provider-inflight";
import type { MarketingPublication } from "../types";
import type { MarketingIncidentType } from "./types";

export type AutoResolveDecision =
  | { action: "resolve"; summary: string }
  | { action: "skip"; reason: string };

export function publicationRowBlocksAutoResolve(
  publication: MarketingPublication,
): { blocked: boolean; reason?: string } {
  const ambiguityState = publication.ambiguityState ?? "none";
  if (isPublicationAmbiguityBlocked(ambiguityState)) {
    return { blocked: true, reason: "ambiguity_state" };
  }
  if (isProviderInflightMarker(publication.providerCreationId)) {
    return { blocked: true, reason: "provider_inflight" };
  }
  if (isInstagramProviderMediaRecoveryRequired(publication)) {
    return { blocked: true, reason: "instagram_recovery_required" };
  }
  if (
    (publication.status === "failed" || publication.status === "processing") &&
    isPersistedProviderCreationId(publication.providerCreationId) &&
    !publication.externalId
  ) {
    return { blocked: true, reason: "provider_creation_without_external_id" };
  }
  return { blocked: false };
}

export function evaluateOverdueAutoResolve(
  publication: MarketingPublication,
  now: Date = new Date(),
): AutoResolveDecision {
  if (publication.status === "published") {
    return {
      action: "resolve",
      summary:
        "Automatically resolved after publication status changed to published.",
    };
  }
  if (publication.status === "failed") {
    return {
      action: "resolve",
      summary:
        "Automatically resolved after publication status changed to failed.",
    };
  }
  if (publication.status === "scheduled") {
    if (!publication.scheduledFor?.trim()) {
      return { action: "skip", reason: "scheduled_without_scheduled_for" };
    }
    if (isPublicationOverdue(publication, now)) {
      return { action: "skip", reason: "still_overdue" };
    }
    return {
      action: "resolve",
      summary:
        "Automatically resolved after the publication was scheduled outside the overdue threshold.",
    };
  }
  if (publication.status === "processing") {
    return {
      action: "resolve",
      summary:
        "Automatically resolved after publication left scheduled processing state.",
    };
  }
  if (publication.status === "queued") {
    return {
      action: "resolve",
      summary:
        "Automatically resolved after publication left the overdue scheduled state.",
    };
  }
  return { action: "skip", reason: `unsupported_status:${publication.status}` };
}

export function evaluateStuckAutoResolve(
  publication: MarketingPublication,
): AutoResolveDecision {
  if (publication.status === "processing") {
    return { action: "skip", reason: "still_processing" };
  }
  if (publication.status === "published") {
    return {
      action: "resolve",
      summary:
        "Automatically resolved after publication status changed to published.",
    };
  }
  if (publication.status === "failed") {
    return {
      action: "resolve",
      summary:
        "Automatically resolved after publication left processing with status failed.",
    };
  }
  if (publication.status === "scheduled" || publication.status === "queued") {
    return {
      action: "resolve",
      summary: `Automatically resolved after publication left processing with status ${publication.status}.`,
    };
  }
  return { action: "skip", reason: `unsupported_status:${publication.status}` };
}

export function evaluateAutoResolveForIncident(
  incidentType: MarketingIncidentType,
  publication: MarketingPublication,
  now?: Date,
): AutoResolveDecision {
  if (incidentType === "publication_overdue") {
    return evaluateOverdueAutoResolve(publication, now);
  }
  if (incidentType === "publication_stuck_processing") {
    return evaluateStuckAutoResolve(publication);
  }
  return { action: "skip", reason: "incident_type_not_eligible" };
}
