import { composePublishCaption } from "./meta";
import { buildPublishTrackingLink } from "./tracking";
import type { MarketingContent } from "./types";

export function appendTrackingUrlToCaption(caption: string, trackingUrl: string): string {
  const trimmed = caption.trim();
  if (!trackingUrl.trim()) return trimmed.slice(0, 2200);
  if (trimmed.includes(trackingUrl)) return trimmed.slice(0, 2200);
  const combined = trimmed ? `${trimmed}\n\n${trackingUrl}` : trackingUrl;
  return combined.slice(0, 2200);
}

/** Caption sent to Meta publishers, including tracked site link when available. */
export function composeSocialPublishCaption(content: MarketingContent): string {
  const base = composePublishCaption(content.body, content.cta);
  const trackingLink = buildPublishTrackingLink(content);
  if (!trackingLink) return base;
  return appendTrackingUrlToCaption(base, trackingLink);
}
