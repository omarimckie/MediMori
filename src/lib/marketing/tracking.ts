import { logMarketing } from "./logger";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

export function trackingDestinationPath(content: MarketingContent | null): string {
  if (!content) return "/books";
  return content.bookId ? `/books/${content.bookId}` : "/books";
}

export function buildTrackingRedirect(
  requestUrl: string,
  content: MarketingContent | null,
): URL {
  const destination = trackingDestinationPath(content);
  const url = new URL(destination, requestUrl);
  if (!content) return url;
  url.searchParams.set("utm_source", content.platform);
  url.searchParams.set("utm_medium", "marketing_autopilot");
  if (content.campaignId) url.searchParams.set("utm_campaign", content.campaignId);
  url.searchParams.set("utm_content", content.id);
  return url;
}

export async function persistMarketingClick(
  store: MarketingStore,
  content: MarketingContent,
  token: string,
): Promise<boolean> {
  try {
    await store.recordClick({
      token,
      contentId: content.id,
      campaignId: content.campaignId,
      bookId: content.bookId,
      destinationPath: trackingDestinationPath(content),
    });
    await store.recordEvent({
      id: crypto.randomUUID(),
      name: "content_clicked",
      campaignId: content.campaignId,
      contentId: content.id,
      platform: content.platform,
      properties: { bookId: content.bookId },
    });
    return true;
  } catch (error) {
    logMarketing({
      operation: "record_click",
      campaignId: content.campaignId,
      contentId: content.id,
      success: false,
      error: error instanceof Error ? error.message : "click_persist_failed",
    });
    return false;
  }
}
