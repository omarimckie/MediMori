import { getAssetImageTruth } from "./asset-truth";
import { resolveContentImageUrl } from "./assets";
import { PLATFORM_LABELS } from "./config";
import {
  contentFormatUsesSocialImage,
  describeAspectRatioFailure,
  isAssetSuitableForPlatform,
} from "./platform-suitability";
import { runPublishPreflight } from "./publish-preflight";
import type { MarketingStore } from "./store";
import type { ContentFormat, MarketingContent, Platform } from "./types";

export type WeeklyItemReview = {
  channelLabel: string;
  showVisualPreview: boolean;
  /** Same URL scheduling/publish preflight resolves (absolute when site-relative). */
  previewUrl: string | null;
  dimensionsLabel: string | null;
  visualSuitabilityWarning: string | null;
};

function humanizeFormat(format: ContentFormat): string {
  if (format === "reel_script") return "Reel";
  if (format === "google_update") return "Update";
  return format.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Channel line for the weekly approval card (no client-side suitability rules). */
export function weeklyChannelLabel(content: MarketingContent): string {
  if (content.platform === "pinterest" && content.format === "pin") {
    return "Pinterest · Pin · Vertical";
  }
  const platform = PLATFORM_LABELS[content.platform as Platform] ?? content.platform;
  const format = humanizeFormat(content.format);
  return `${platform} · ${format}`;
}

async function resolvePrimaryApprovedAsset(store: MarketingStore, content: MarketingContent) {
  for (const assetId of content.assetIds) {
    const asset = await store.getAsset(assetId);
    if (asset?.approved && asset.url?.trim()) return asset;
  }
  return null;
}

function suitabilityWarning(
  content: MarketingContent,
  channelLabel: string,
  preflightMessage: string | null,
): string | null {
  if (!preflightMessage) return null;
  if (content.platform === "pinterest" && content.format === "pin") {
    return `Visual is not suitable for ${channelLabel}. ${preflightMessage}`;
  }
  return `Visual is not suitable for this channel. ${preflightMessage}`;
}

export async function buildWeeklyItemReview(
  store: MarketingStore,
  content: MarketingContent,
): Promise<WeeklyItemReview> {
  const channelLabel = weeklyChannelLabel(content);
  const showVisualPreview = contentFormatUsesSocialImage(content.platform, content.format);

  if (!showVisualPreview) {
    return {
      channelLabel,
      showVisualPreview: false,
      previewUrl: null,
      dimensionsLabel: null,
      visualSuitabilityWarning: null,
    };
  }

  const previewUrl = await resolveContentImageUrl(store, content);
  const asset = await resolvePrimaryApprovedAsset(store, content);
  let dimensionsLabel: string | null = null;
  let visualSuitabilityWarning: string | null = null;

  if (asset) {
    const truth = await getAssetImageTruth(asset);
    if (truth) {
      dimensionsLabel = `${truth.width} × ${truth.height} · ${truth.aspectRatioLabel}`;
      if (
        !isAssetSuitableForPlatform(truth, content.platform, content.format)
      ) {
        visualSuitabilityWarning = suitabilityWarning(
          content,
          channelLabel,
          describeAspectRatioFailure(content.platform, truth, content.format),
        );
      }
    }
  }

  if (!visualSuitabilityWarning) {
    const preflight = await runPublishPreflight(store, content);
    if (!preflight.ok) {
      visualSuitabilityWarning = suitabilityWarning(content, channelLabel, preflight.message);
    }
  }

  return {
    channelLabel,
    showVisualPreview: true,
    previewUrl,
    dimensionsLabel,
    visualSuitabilityWarning,
  };
}
