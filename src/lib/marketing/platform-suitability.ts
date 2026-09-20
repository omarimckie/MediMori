import type { AssetImageTruth } from "./asset-truth";
import type { ContentFormat, Platform } from "./types";

/** Instagram feed image posts: width/height ratio must fall in this inclusive range. */
export const INSTAGRAM_FEED_ASPECT_RATIO_MIN = 0.8;
export const INSTAGRAM_FEED_ASPECT_RATIO_MAX = 1.91;

/**
 * Conservative Facebook feed photo range (wider than Instagram to avoid false rejects).
 * Pinterest uses {@link isAssetSuitableForPlatform} with ratio checks deferred until live publish.
 */
export const FACEBOOK_FEED_ASPECT_RATIO_MIN = 0.5;
export const FACEBOOK_FEED_ASPECT_RATIO_MAX = 2.0;

export type PlatformImageRule = {
  requiresImage: boolean;
  requiresAspectRatio: boolean;
  minRatio: number | null;
  maxRatio: number | null;
};

const SOCIAL_IMAGE_FORMATS = new Set<ContentFormat>([
  "post",
  "carousel",
  "pin",
  "story",
  "reel_script",
]);

export function contentFormatUsesSocialImage(
  platform: Platform,
  format: ContentFormat,
): boolean {
  if (platform === "email" || platform === "website" || platform === "google") {
    return false;
  }
  if (platform === "pinterest") return format === "pin";
  return SOCIAL_IMAGE_FORMATS.has(format);
}

export function platformImageRule(platform: Platform, format: ContentFormat): PlatformImageRule {
  const usesImage = contentFormatUsesSocialImage(platform, format);
  if (!usesImage) {
    return {
      requiresImage: false,
      requiresAspectRatio: false,
      minRatio: null,
      maxRatio: null,
    };
  }
  if (platform === "instagram") {
    return {
      requiresImage: true,
      requiresAspectRatio: true,
      minRatio: INSTAGRAM_FEED_ASPECT_RATIO_MIN,
      maxRatio: INSTAGRAM_FEED_ASPECT_RATIO_MAX,
    };
  }
  if (platform === "facebook") {
    return {
      requiresImage: true,
      requiresAspectRatio: true,
      minRatio: FACEBOOK_FEED_ASPECT_RATIO_MIN,
      maxRatio: FACEBOOK_FEED_ASPECT_RATIO_MAX,
    };
  }
  if (platform === "pinterest") {
    return {
      requiresImage: true,
      requiresAspectRatio: false,
      minRatio: null,
      maxRatio: null,
    };
  }
  return {
    requiresImage: false,
    requiresAspectRatio: false,
    minRatio: null,
    maxRatio: null,
  };
}

export function aspectRatioInRange(
  ratio: number,
  min: number | null,
  max: number | null,
): boolean {
  if (min !== null && ratio < min) return false;
  if (max !== null && ratio > max) return false;
  return true;
}

export function isAssetSuitableForPlatform(
  truth: AssetImageTruth | null,
  platform: Platform,
  format: ContentFormat,
): boolean {
  const rule = platformImageRule(platform, format);
  if (!rule.requiresImage) return true;
  if (!truth) return false;
  if (!rule.requiresAspectRatio) return true;
  return aspectRatioInRange(truth.aspectRatio, rule.minRatio, rule.maxRatio);
}

export function describeAspectRatioFailure(
  platform: Platform,
  truth: AssetImageTruth,
): string {
  const rule = platformImageRule(platform, "post");
  if (rule.minRatio !== null && rule.maxRatio !== null) {
    return `Image aspect ratio ${truth.aspectRatio.toFixed(3)} (${truth.aspectRatioLabel}) is outside ${platform} acceptable range ${rule.minRatio}–${rule.maxRatio} (width/height).`;
  }
  return `Image is not suitable for ${platform}.`;
}
