import type { MarketingAsset, MarketingContent } from "./types";

/** Alt text for Pinterest: metadata override, else truncate body/title. */
export function resolvePrimaryImageAltText(content: MarketingContent): string {
  const fromMeta = content.metadata.pinAltText?.trim();
  if (fromMeta) return fromMeta.slice(0, 500);
  const fromTitle = content.title?.trim();
  if (fromTitle) return fromTitle.slice(0, 500);
  return content.body.trim().slice(0, 500);
}

export function resolvePinAltTextFromAsset(asset: MarketingAsset | null, content: MarketingContent): string {
  const fromMeta = content.metadata.pinAltText?.trim();
  if (fromMeta) return fromMeta.slice(0, 500);
  if (asset?.altText?.trim()) return asset.altText.trim().slice(0, 500);
  return resolvePrimaryImageAltText(content);
}
