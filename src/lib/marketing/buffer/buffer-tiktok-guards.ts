import type { MarketingPublication } from "../types";

export function isBufferTikTokPublication(
  publication: Pick<MarketingPublication, "platform" | "provider">,
): boolean {
  return (
    publication.platform === "tiktok" &&
    (publication.provider === "buffer_tiktok" || publication.provider.startsWith("mock:buffer_tiktok"))
  );
}

/** Block admin/cron re-publish when Buffer already accepted a post id. */
export function isBufferTikTokDuplicateRetryBlocked(
  publication: Pick<MarketingPublication, "platform" | "provider" | "externalId">,
): boolean {
  if (!isBufferTikTokPublication(publication)) return false;
  return Boolean(publication.externalId?.trim());
}

export function bufferTikTokDuplicateRetryMessage(): string {
  return "TikTok content was already submitted to Buffer. Reconcile remote status before retrying.";
}