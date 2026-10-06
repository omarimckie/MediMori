import type { MarketingPublication } from "./types";
import { isPublicationBlockedForAutomaticMetaRetry } from "./publication-ambiguity/guards";

/**
 * Cron auto-retry eligibility requires Phase 2A structured proof on NEW failures.
 * Legacy `[cron_auto_retryable]` and bare "transient" substrings are NOT sufficient
 * (pre-2A rows cannot be proven safe). Persisted provider_creation_id (non-inflight)
 * and ambiguous state also block retry.
 */
export const PUBLICATION_CRON_AUTO_RETRY_MARKER = "[cron_auto_retryable]";

/** Structured proof stamped only for NEW confirmed-safe retryable failures (Phase 2A+). */
export const PUBLICATION_CRON_SAFE_RETRY_PROOF = "[cron_safe_retry:v1]";

export function formatPublicationFailureLastError(
  error: string,
  cronAutoRetry: boolean,
): string {
  const trimmed = error.trim() || "Publish failed";
  if (!cronAutoRetry) return trimmed;
  if (trimmed.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF)) return trimmed;
  return `${trimmed} ${PUBLICATION_CRON_SAFE_RETRY_PROOF}`;
}

export function isPublicationEligibleForCronAutoRetry(
  lastError: string | null | undefined,
  publication?: Pick<
    MarketingPublication,
    "ambiguityState" | "providerCreationId" | "status"
  >,
): boolean {
  if (publication && isPublicationBlockedForAutomaticMetaRetry(publication)) {
    return false;
  }
  if (!lastError) return false;
  if (lastError.includes("publication_ambiguous:")) return false;
  return lastError.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF);
}

export function shouldStampCronAutoRetryForPlatform(
  platform: string,
  providerRetryable: boolean,
): boolean {
  if (!providerRetryable) return false;
  return platform === "instagram" || platform === "facebook";
}
