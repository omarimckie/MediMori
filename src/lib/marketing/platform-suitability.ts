import type { AssetImageTruth } from "./asset-truth";
import type { ContentFormat, Platform } from "./types";

/** Instagram feed image posts: width/height ratio must fall in this inclusive range. */
export const INSTAGRAM_FEED_ASPECT_RATIO_MIN = 0.8;
export const INSTAGRAM_FEED_ASPECT_RATIO_MAX = 1.91;

/**
 * Conservative Facebook feed photo range (wider than Instagram to avoid false rejects).
 */
export const FACEBOOK_FEED_ASPECT_RATIO_MIN = 0.5;
export const FACEBOOK_FEED_ASPECT_RATIO_MAX = 2.0;

/**
 * Pinterest standard Pin image guidance (help.pinterest.com Pin specs / product specs):
 * - Minimum practical width 600px
 * - Vertical aspect ratios from 1:2.1 (tall) through 2:3 (recommended); wider than 2:3 may be cropped in feed
 */
export const PINTEREST_MIN_IMAGE_WIDTH = 600;
/** width / height — tallest allowed (1:2.1). */
export const PINTEREST_ASPECT_RATIO_MIN = 1 / 2.1;
/** width / height — 2:3 recommended maximum width for standard vertical pins. */
export const PINTEREST_ASPECT_RATIO_MAX = 2 / 3;

const PINTEREST_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

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
      requiresAspectRatio: true,
      minRatio: PINTEREST_ASPECT_RATIO_MIN,
      maxRatio: PINTEREST_ASPECT_RATIO_MAX,
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
  format: ContentFormat = "post",
): string {
  const rule = platformImageRule(platform, format);
  if (platform === "pinterest") {
    if (truth.width < PINTEREST_MIN_IMAGE_WIDTH) {
      return `Pinterest image width ${truth.width}px is below the minimum ${PINTEREST_MIN_IMAGE_WIDTH}px.`;
    }
    if (!PINTEREST_ALLOWED_MIME.has(truth.mimeType.toLowerCase())) {
      return `Pinterest image type ${truth.mimeType} is not supported. Use JPEG, PNG, or WebP.`;
    }
  }
  if (rule.minRatio !== null && rule.maxRatio !== null) {
    return `Image aspect ratio ${truth.aspectRatio.toFixed(3)} (${truth.aspectRatioLabel}) is outside ${platform} acceptable range ${rule.minRatio.toFixed(3)}–${rule.maxRatio.toFixed(3)} (width/height).`;
  }
  return `Image is not suitable for ${platform}.`;
}

export function isPinterestMimeAllowed(mimeType: string): boolean {
  return PINTEREST_ALLOWED_MIME.has(mimeType.toLowerCase());
}
