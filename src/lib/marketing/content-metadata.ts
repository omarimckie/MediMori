import { formatAspectRatioLabel } from "./asset-truth";
import type { MarketingAsset, MarketingContent, ResourceType } from "./types";

export const MANUAL_UPLOAD_SOURCE = "manual_upload";
export const SMART_UPLOAD_SOURCE = "smart_upload";
export const PRIVATE_BLOB_PATH_TAG = "private_blob_path:";

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  coloring_page: "Coloring page",
  word_search: "Word search",
  crossword: "Crossword",
  maze: "Maze",
  worksheet: "Worksheet",
  activity_sheet: "Activity sheet",
  other: "Other",
};

export function isManualUpload(content: MarketingContent): boolean {
  return content.metadata?.source === MANUAL_UPLOAD_SOURCE;
}

export function contentPlacement(content: MarketingContent): string | null {
  return content.metadata?.placement ?? null;
}

export function slugifyResourceTitle(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "resource";
}

export function isFreeResourceContent(content: MarketingContent): boolean {
  return content.platform === "website" && content.format === "free_resource";
}

/** Matches slugs produced by {@link slugifyResourceTitle} for public URL segments. */
const PUBLIC_FREE_RESOURCE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPublicFreeResourceSlug(slug: string): boolean {
  const normalized = slug.trim();
  if (!normalized || normalized.length > 80) return false;
  if (normalized.includes("/") || normalized.includes("..")) return false;
  return PUBLIC_FREE_RESOURCE_SLUG_PATTERN.test(normalized);
}

export function freeResourcePublicPath(slug: string): string {
  return `/resources/free/${slug}`;
}

export function aspectRatioHint(
  content: MarketingContent,
  assets: Map<string, MarketingAsset>,
): string | null {
  const primary = content.assetIds.map((id) => assets.get(id)).find(Boolean);
  if (!primary?.imageWidth || !primary.imageHeight) return null;
  const ratio = primary.imageWidth / primary.imageHeight;
  const label = formatAspectRatioLabel(primary.imageWidth, primary.imageHeight);
  if (content.platform === "pinterest" && ratio < 1) return `${label} · Vertical`;
  if (content.platform === "instagram" && ratio >= 0.75 && ratio <= 0.85) {
    return `${label} · 4:5`;
  }
  return label;
}

export function weeklyChannelLabel(
  content: MarketingContent,
  assets: Map<string, MarketingAsset>,
): string {
  if (isFreeResourceContent(content)) {
    const type = content.metadata.resourceType
      ? RESOURCE_TYPE_LABELS[content.metadata.resourceType]
      : "Free resource";
    return `Website · Free Resource · ${type}`;
  }
  if (content.platform === "pinterest" && content.format === "pin") {
    return "Pinterest · Pin · Vertical";
  }

  const platform =
    content.platform === "instagram"
      ? "Instagram"
      : content.platform === "facebook"
        ? "Facebook"
        : content.platform === "pinterest"
          ? "Pinterest"
          : content.platform;
  const placement = contentPlacement(content);
  const placementLabel =
    placement === "feed"
      ? "Feed"
      : placement === "pin"
        ? "Pin"
        : placement === "story"
          ? "Story"
          : null;
  const parts = [platform];
  if (placementLabel) parts.push(placementLabel);
  const aspect = aspectRatioHint(content, assets);
  if (aspect) parts.push(aspect);
  return parts.join(" · ");
}
