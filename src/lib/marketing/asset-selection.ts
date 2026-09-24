import { getAssetImageTruth, type AssetImageTruth } from "./asset-truth";
import {
  contentFormatUsesSocialImage,
  isAssetSuitableForPlatform,
  PINTEREST_ASPECT_RATIO_MAX,
} from "./platform-suitability";
import type {
  ContentCategory,
  ContentFormat,
  MarketingAsset,
  Platform,
} from "./types";

export type SelectAssetArgs = {
  bookId: string | null;
  characterId: string | null;
  platform: Platform;
  format: ContentFormat;
  category: ContentCategory;
  /** Pinterest weekly generation: do not reuse assets already assigned to sibling pins. */
  excludeAssetIds?: string[];
};

export type SelectAssetResult = {
  asset: MarketingAsset | null;
  needsNewAsset: boolean;
  source: string;
};

const TYPE_PRIORITY: Record<string, number> = {
  cover: 0,
  interior: 1,
  character: 2,
  template: 3,
};

const PINTEREST_TYPE_PRIORITY: Partial<Record<ContentCategory, Record<string, number>>> = {
  educational: { interior: 0, character: 1, cover: 2, template: 3 },
  engagement: { character: 0, interior: 1, cover: 2, template: 3 },
  community: { character: 0, interior: 1, cover: 2, template: 3 },
  product_feature: { character: 0, interior: 1, cover: 2, template: 3 },
  brand_story: { character: 0, interior: 1, cover: 2, template: 3 },
};

function typePriorityFor(args: SelectAssetArgs): Record<string, number> {
  if (args.platform === "pinterest" && args.format === "pin") {
    return PINTEREST_TYPE_PRIORITY[args.category] ?? { character: 0, interior: 1, cover: 2, template: 3 };
  }
  return TYPE_PRIORITY;
}

function compareByType(
  a: MarketingAsset,
  b: MarketingAsset,
  priority: Record<string, number>,
): number {
  const pa = priority[a.type] ?? 99;
  const pb = priority[b.type] ?? 99;
  return pa - pb;
}

/** Prefer vertical pins near Pinterest's 2:3 guidance (higher score = better). */
function pinterestVerticalScore(truth: AssetImageTruth | null): number {
  if (!truth) return -1;
  const ideal = PINTEREST_ASPECT_RATIO_MAX;
  if (truth.aspectRatio > ideal) return -1;
  return -Math.abs(truth.aspectRatio - ideal);
}

function selectFromCandidates(
  candidates: MarketingAsset[],
  suitable: (asset: MarketingAsset, truth: AssetImageTruth | null) => boolean,
  truths: Map<string, AssetImageTruth | null>,
  args: SelectAssetArgs,
): MarketingAsset | null {
  const priority = typePriorityFor(args);
  const ranked = [...candidates].sort((a, b) => {
    const suitableA = suitable(a, truths.get(a.id) ?? null);
    const suitableB = suitable(b, truths.get(b.id) ?? null);
    if (suitableA !== suitableB) return suitableA ? -1 : 1;
    const typeCmp = compareByType(a, b, priority);
    if (typeCmp !== 0) return typeCmp;
    if (args.platform === "pinterest" && args.format === "pin") {
      return (
        pinterestVerticalScore(truths.get(b.id) ?? null) -
        pinterestVerticalScore(truths.get(a.id) ?? null)
      );
    }
    return 0;
  });
  for (const asset of ranked) {
    if (suitable(asset, truths.get(asset.id) ?? null)) return asset;
  }
  return null;
}

function selectPinterestPinAsset(
  approved: MarketingAsset[],
  truths: Map<string, AssetImageTruth | null>,
  args: SelectAssetArgs,
): SelectAssetResult {
  const excluded = new Set(args.excludeAssetIds ?? []);
  const byBook = approved.filter((asset) => !args.bookId || asset.bookId === args.bookId);
  const candidates = byBook.filter((asset) => !excluded.has(asset.id));
  const suitable = (asset: MarketingAsset, truth: AssetImageTruth | null) =>
    isAssetSuitableForPlatform(truth, args.platform, args.format);

  const match = selectFromCandidates(candidates, suitable, truths, args);
  if (match) {
    return { asset: match, needsNewAsset: false, source: "existing_approved_asset" };
  }
  const template = approved.find((asset) => asset.type === "template" && !excluded.has(asset.id));
  if (template && suitable(template, truths.get(template.id) ?? null)) {
    return { asset: template, needsNewAsset: false, source: "existing_template" };
  }
  return { asset: null, needsNewAsset: true, source: "new_generated_asset_request" };
}

/**
 * Platform-aware asset selection using resolved image truth (not catalog aspect_ratio labels).
 */
export function selectAssetWithTruths(
  assets: MarketingAsset[],
  truths: Map<string, AssetImageTruth | null>,
  args: SelectAssetArgs,
): SelectAssetResult {
  const approved = assets.filter((asset) => asset.approved);
  const byBook = approved.filter((asset) => !args.bookId || asset.bookId === args.bookId);

  const needsSocialImage = contentFormatUsesSocialImage(args.platform, args.format);

  if (needsSocialImage) {
    if (args.platform === "pinterest" && args.format === "pin") {
      return selectPinterestPinAsset(approved, truths, args);
    }
    const suitable = (asset: MarketingAsset, truth: AssetImageTruth | null) =>
      isAssetSuitableForPlatform(truth, args.platform, args.format);
    const match = selectFromCandidates(byBook, suitable, truths, args);
    if (match) {
      return { asset: match, needsNewAsset: false, source: "existing_approved_asset" };
    }
    const template = approved.find((asset) => asset.type === "template");
    if (template && suitable(template, truths.get(template.id) ?? null)) {
      return { asset: template, needsNewAsset: false, source: "existing_template" };
    }
    return { asset: null, needsNewAsset: true, source: "new_generated_asset_request" };
  }

  const character = byBook.find(
    (asset) => args.characterId && asset.characterId === args.characterId,
  );
  if (character) {
    return { asset: character, needsNewAsset: false, source: "existing_approved_asset" };
  }
  const cover = byBook.find((asset) => asset.type === "cover");
  if (cover) return { asset: cover, needsNewAsset: false, source: "existing_approved_asset" };
  const interior = byBook.find((asset) => asset.type === "interior");
  if (interior) {
    return { asset: interior, needsNewAsset: false, source: "existing_asset_transformed" };
  }
  const template = approved.find((asset) => asset.type === "template");
  if (template) return { asset: template, needsNewAsset: false, source: "existing_template" };
  return { asset: null, needsNewAsset: true, source: "new_generated_asset_request" };
}

export async function resolveTruthsForAssets(
  assets: MarketingAsset[],
): Promise<Map<string, AssetImageTruth | null>> {
  const truths = new Map<string, AssetImageTruth | null>();
  for (const asset of assets) {
    truths.set(asset.id, await getAssetImageTruth(asset));
  }
  return truths;
}

export async function selectAssetAsync(
  assets: MarketingAsset[],
  args: SelectAssetArgs,
): Promise<SelectAssetResult> {
  const truths = await resolveTruthsForAssets(assets);
  return selectAssetWithTruths(assets, truths, args);
}
