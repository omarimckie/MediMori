import { sanitizeEvidence, sanitizeErrorMessage } from "../incidents/sanitize";
import {
  isPersistedProviderCreationId,
  isProviderInflightMarker,
} from "../publication-ambiguity/provider-inflight";
import type { MarketingPublication } from "../types";

export function parsePublicationErrorClass(lastError: string | null | undefined): string {
  const raw = lastError?.trim() ?? "";
  if (!raw) return "unknown_error";
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const code = raw.slice(0, colon).trim();
    if (code) return code;
  }
  return "publish_failed";
}

export function publicationIncidentEvidence(
  publication: MarketingPublication,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const providerCreationId = publication.providerCreationId;
  return sanitizeEvidence({
    publication_id: publication.id,
    content_id: publication.contentId,
    platform: publication.platform,
    provider: publication.provider,
    attempt_count: publication.attemptCount,
    ambiguity_state: publication.ambiguityState,
    has_persisted_provider_creation_id: isPersistedProviderCreationId(providerCreationId),
    provider_inflight_marker: isProviderInflightMarker(providerCreationId),
    ...extra,
  });
}

export function publicationIncidentSanitizedError(publication: MarketingPublication): string {
  return sanitizeErrorMessage(publication.lastError ?? "Publication safety condition detected.");
}
