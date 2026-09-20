import { resolveContentImageUrl } from "./assets";
import { getAssetImageTruth } from "./asset-truth";
import { isMockMode } from "./config";
import { isPublicHttpsImageUrl, publicImageUrlError } from "./meta";
import {
  contentFormatUsesSocialImage,
  describeAspectRatioFailure,
  isAssetSuitableForPlatform,
  platformImageRule,
} from "./platform-suitability";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

export type PreflightErrorCode =
  | "image_missing"
  | "image_unreadable"
  | "invalid_aspect_ratio"
  | "invalid_asset"
  | "unsupported_platform_asset";

export type PublishPreflightResult =
  | { ok: true; imageUrl: string | null }
  | { ok: false; code: PreflightErrorCode; message: string };

async function resolvePrimaryAsset(
  store: MarketingStore,
  content: MarketingContent,
) {
  for (const assetId of content.assetIds) {
    const asset = await store.getAsset(assetId);
    if (asset?.approved && asset.url?.trim()) return asset;
  }
  return null;
}

/**
 * Validates publish readiness without calling external APIs.
 * Shared by scheduling and publishing (defense in depth).
 */
export async function runPublishPreflight(
  store: MarketingStore,
  content: MarketingContent,
): Promise<PublishPreflightResult> {
  const rule = platformImageRule(content.platform, content.format);
  const imageUrl = await resolveContentImageUrl(store, content);

  if (!rule.requiresImage) {
    return { ok: true, imageUrl };
  }

  if (!imageUrl?.trim()) {
    return {
      ok: false,
      code: "image_missing",
      message: "No approved image is attached to this content.",
    };
  }

  if (!isMockMode()) {
    const urlError = publicImageUrlError(imageUrl);
    if (urlError) {
      return {
        ok: false,
        code: "invalid_asset",
        message: urlError,
      };
    }

    if (!isPublicHttpsImageUrl(imageUrl)) {
      return {
        ok: false,
        code: "invalid_asset",
        message: "Image URL must be publicly reachable over HTTPS.",
      };
    }
  }

  const asset = await resolvePrimaryAsset(store, content);
  if (!asset) {
    return {
      ok: false,
      code: "image_missing",
      message: "No approved catalog asset is linked to this content.",
    };
  }

  const truth = await getAssetImageTruth(asset);
  if (!truth) {
    return {
      ok: false,
      code: "image_unreadable",
      message: `Could not read image dimensions for ${asset.url ?? "attached asset"}.`,
    };
  }

  if (
    contentFormatUsesSocialImage(content.platform, content.format) &&
    !isAssetSuitableForPlatform(truth, content.platform, content.format)
  ) {
    return {
      ok: false,
      code: "invalid_aspect_ratio",
      message: describeAspectRatioFailure(content.platform, truth),
    };
  }

  return { ok: true, imageUrl };
}

export function formatPreflightError(result: PublishPreflightResult & { ok: false }): string {
  return `${result.code}: ${result.message}`;
}
