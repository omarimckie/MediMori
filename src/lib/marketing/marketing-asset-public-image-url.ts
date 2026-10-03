import { absoluteUrl } from "@/lib/site";
import type { MarketingAsset, ContentStatus } from "./types";
import {
  isBlobBackedMarketingPublicImageAsset,
  isContentStatusEligibleForPublicMarketingAssetProxy,
} from "./marketing-asset-public-image";

export function marketingAssetPublicImageApiPath(assetId: string): string {
  return `/api/marketing/assets/${assetId}/image`;
}

export function marketingAssetPublicImageUrl(
  assetId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return absoluteUrl(marketingAssetPublicImageApiPath(assetId), env);
}

export function resolvePublishableMarketingAssetUrl(
  asset: MarketingAsset,
  contentStatus: ContentStatus,
  env: Record<string, string | undefined> = process.env,
): string {
  if (
    isBlobBackedMarketingPublicImageAsset(asset) &&
    isContentStatusEligibleForPublicMarketingAssetProxy(contentStatus)
  ) {
    return marketingAssetPublicImageUrl(asset.id, env);
  }
  const url = asset.url?.trim() ?? "";
  if (/^https?:\/\//i.test(url)) return url;
  return absoluteUrl(url);
}
