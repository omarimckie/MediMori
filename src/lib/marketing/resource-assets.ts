import { PRIVATE_BLOB_PATH_TAG } from "./content-metadata";
import type { MarketingAsset, MarketingContent } from "./types";

export function privateBlobPathFromAsset(asset: MarketingAsset): string | null {
  const tag = asset.tags.find((item) => item.startsWith(PRIVATE_BLOB_PATH_TAG));
  if (!tag) return null;
  return tag.slice(PRIVATE_BLOB_PATH_TAG.length);
}

export function previewAssetForContent(
  assets: MarketingAsset[],
  content: MarketingContent,
): MarketingAsset | null {
  for (const id of content.assetIds) {
    const row = assets.find((item) => item.id === id);
    if (row?.type === "resource_preview" && row.url) return row;
  }
  for (const id of content.assetIds) {
    const row = assets.find((item) => item.id === id);
    if (row?.url && row.type !== "resource_file") return row;
  }
  return null;
}

export function fileAssetForContent(
  assets: MarketingAsset[],
  content: MarketingContent,
): MarketingAsset | null {
  for (const id of content.assetIds) {
    const row = assets.find((item) => item.id === id);
    if (row?.type === "resource_file") return row;
  }
  return null;
}
