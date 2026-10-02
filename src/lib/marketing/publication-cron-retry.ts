/**
 * Cron auto-retry eligibility is derived from persisted last_error only (no DB flag).
 * Legacy rows and mock publishers still match the substring "transient".
 * Meta network failures use meta_http_error: without "transient" — indistinguishable from
 * non-retryable meta_http_error — so retryable Meta failures are stamped at write time.
 */
export const PUBLICATION_CRON_AUTO_RETRY_MARKER = "[cron_auto_retryable]";

export function formatPublicationFailureLastError(
  error: string,
  cronAutoRetry: boolean,
): string {
  const trimmed = error.trim() || "Publish failed";
  if (!cronAutoRetry) return trimmed;
  if (trimmed.includes(PUBLICATION_CRON_AUTO_RETRY_MARKER)) return trimmed;
  return `${trimmed} ${PUBLICATION_CRON_AUTO_RETRY_MARKER}`;
}

export function isPublicationEligibleForCronAutoRetry(
  lastError: string | null | undefined,
): boolean {
  if (!lastError) return false;
  if (lastError.includes(PUBLICATION_CRON_AUTO_RETRY_MARKER)) return true;
  if (lastError.includes("transient")) return true;
  return false;
}

export function shouldStampCronAutoRetryForPlatform(
  platform: string,
  providerRetryable: boolean,
): boolean {
  if (!providerRetryable) return false;
  return platform === "instagram" || platform === "facebook";
}
