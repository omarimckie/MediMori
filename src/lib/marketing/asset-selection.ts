import { getAssetImageTruth, type AssetImageTruth } from "./asset-truth";
import { contentFormatUsesSocialImage, isAssetSuitableForPlatform } from "./platform-suitability";
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

function compareByType(a: MarketingAsset, b: MarketingAsset): number {
  const pa = TYPE_PRIORITY[a.type] ?? 99;
  const pb = TYPE_PRIORITY[b.type] ?? 99;
  return pa - pb;
}

function selectFromCandidates(
  candidates: MarketingAsset[],
  suitable: (asset: MarketingAsset, truth: AssetImageTruth | null) => boolean,
  truths: Map<string, AssetImageTruth | null>,
): MarketingAsset | null {
  const ranked = [...candidates].sort(compareByType);
  for (const asset of ranked) {
    if (suitable(asset, truths.get(asset.id) ?? null)) return asset;
  }
  return null;
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
    const suitable = (asset: MarketingAsset, truth: AssetImageTruth | null) =>
      isAssetSuitableForPlatform(truth, args.platform, args.format);
    const match = selectFromCandidates(byBook, suitable, truths);
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
