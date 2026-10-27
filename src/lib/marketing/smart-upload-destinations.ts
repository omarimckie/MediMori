import type { AssetImageTruth } from "./asset-truth";
import {
  describeAspectRatioFailure,
  isAssetSuitableForPlatform,
} from "./platform-suitability";
import type { Platform } from "./types";

export type SmartUploadDestinations = {
  facebook: boolean;
  instagram: boolean;
  pinterest: boolean;
};

export const SMART_UPLOAD_DESTINATIONS_ALL: SmartUploadDestinations = {
  facebook: true,
  instagram: true,
  pinterest: true,
};

/** Legacy Smart Upload validation scope (Meta feed only). */
export const SMART_UPLOAD_DESTINATIONS_META_ONLY: SmartUploadDestinations = {
  facebook: true,
  instagram: true,
  pinterest: false,
};

export function normalizeSmartUploadDestinations(
  input?: Partial<SmartUploadDestinations> | null,
): SmartUploadDestinations {
  if (!input) return { ...SMART_UPLOAD_DESTINATIONS_META_ONLY };
  return {
    facebook: Boolean(input.facebook),
    instagram: Boolean(input.instagram),
    pinterest: Boolean(input.pinterest),
  };
}

export function parseSmartUploadDestinationsRecord(
  record: Record<string, unknown> | undefined,
): SmartUploadDestinations {
  if (!record || typeof record !== "object") {
    return { ...SMART_UPLOAD_DESTINATIONS_ALL };
  }
  const facebook = record.facebook;
  const instagram = record.instagram;
  const pinterest = record.pinterest;
  if (facebook === undefined && instagram === undefined && pinterest === undefined) {
    return { ...SMART_UPLOAD_DESTINATIONS_ALL };
  }
  const normalized = normalizeSmartUploadDestinations({
    facebook: facebook === undefined ? true : Boolean(facebook),
    instagram: instagram === undefined ? true : Boolean(instagram),
    pinterest: pinterest === undefined ? true : Boolean(pinterest),
  });
  assertAtLeastOneDestination(normalized);
  return normalized;
}

export function assertAtLeastOneDestination(destinations: SmartUploadDestinations): void {
  if (!destinations.facebook && !destinations.instagram && !destinations.pinterest) {
    throw new Error("At least one platform destination must be selected.");
  }
}

export function metaDestinationsSelected(destinations: SmartUploadDestinations): boolean {
  return destinations.facebook || destinations.instagram;
}

export type SmartUploadValidationIssue = {
  code: string;
  message: string;
  platform?: Platform;
};

export function collectSmartUploadValidationIssues(
  truth: AssetImageTruth,
  destinations: SmartUploadDestinations,
): SmartUploadValidationIssue[] {
  const issues: SmartUploadValidationIssue[] = [];
  if (destinations.instagram && !isAssetSuitableForPlatform(truth, "instagram", "post")) {
    issues.push({
      code: "invalid_aspect_ratio",
      platform: "instagram",
      message: describeAspectRatioFailure("instagram", truth, "post"),
    });
  }
  if (destinations.facebook && !isAssetSuitableForPlatform(truth, "facebook", "post")) {
    issues.push({
      code: "invalid_aspect_ratio",
      platform: "facebook",
      message: describeAspectRatioFailure("facebook", truth, "post"),
    });
  }
  if (destinations.pinterest && !isAssetSuitableForPlatform(truth, "pinterest", "pin")) {
    issues.push({
      code: "invalid_aspect_ratio",
      platform: "pinterest",
      message: describeAspectRatioFailure("pinterest", truth, "pin"),
    });
  }
  return issues;
}

export function metaImagePassesValidation(
  truth: AssetImageTruth,
  destinations: SmartUploadDestinations,
): boolean {
  if (destinations.instagram && !isAssetSuitableForPlatform(truth, "instagram", "post")) {
    return false;
  }
  if (destinations.facebook && !isAssetSuitableForPlatform(truth, "facebook", "post")) {
    return false;
  }
  return true;
}

export function pinterestImagePassesValidation(
  truth: AssetImageTruth,
  destinations: SmartUploadDestinations,
): boolean {
  if (!destinations.pinterest) return true;
  return isAssetSuitableForPlatform(truth, "pinterest", "pin");
}
