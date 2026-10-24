import { resolveContentImageUrl } from "./assets";
import { getAssetImageTruth } from "./asset-truth";
import { isMockMode } from "./config";
import { isPinterestLiveConfigured } from "./pinterest";
import { isPublicHttpsImageUrl, publicImageUrlError } from "./meta";
import {
  contentFormatUsesSocialImage,
  describeAspectRatioFailure,
  isAssetSuitableForPlatform,
  platformImageRule,
} from "./platform-suitability";
import {
  platformRequiresTrackedWebsiteLink,
  socialContentGrandfatheredWithoutTrackedLink,
  validateTrackedWebsiteDestinationForPublish,
} from "./marketing-website-destination";
import { formatPreflightErrorWithRecovery } from "./marketing-publish-operator-guidance";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

export type PreflightErrorCode =
  | "image_missing"
  | "image_unreadable"
  | "invalid_aspect_ratio"
  | "invalid_asset"
  | "tracking_link_required"
  | "destination_path_invalid"
  | "asset_not_ready"
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
function mapTrackedDestinationPreflightCode(
  issue: "tracking_token_missing" | "destination_path_invalid" | "tracking_url_build_failed",
): PreflightErrorCode {
  if (issue === "destination_path_invalid") return "destination_path_invalid";
  return "tracking_link_required";
}

export async function runPublishPreflight(
  store: MarketingStore,
  content: MarketingContent,
): Promise<PublishPreflightResult> {
  if (content.needsNewAsset) {
    return {
      ok: false,
      code: "asset_not_ready",
      message:
        "This content is marked as needing a new approved asset before it can be scheduled or published.",
    };
  }

  if (
    platformRequiresTrackedWebsiteLink(content.platform)
    && !socialContentGrandfatheredWithoutTrackedLink(content)
  ) {
    const linkCheck = validateTrackedWebsiteDestinationForPublish(content);
    if (!linkCheck.ok) {
      return {
        ok: false,
        code: mapTrackedDestinationPreflightCode(linkCheck.code),
        message: linkCheck.message,
      };
    }
  }

  if (content.platform === "pinterest") {
    if (!isMockMode() && !isPinterestLiveConfigured()) {
      return {
        ok: false,
        code: "invalid_asset",
        message:
          "Pinterest live publishing requires PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REFRESH_TOKEN, and PINTEREST_BOARD_ID.",
      };
    }
    const pinTitle = content.title?.trim();
    const pinDescription = content.body?.trim();
    if (!pinTitle || !pinDescription) {
      return {
        ok: false,
        code: "invalid_asset",
        message: "Pinterest pin requires a title and description.",
      };
    }
  }

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
      message: describeAspectRatioFailure(content.platform, truth, content.format),
    };
  }

  return { ok: true, imageUrl };
}

export function formatPreflightError(result: PublishPreflightResult & { ok: false }): string {
  return formatPreflightErrorWithRecovery(result.code, result.message);
}
