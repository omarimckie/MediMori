import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import {
  normalizeSmartUploadDestinations,
  type SmartUploadDestinations,
} from "./smart-upload-destinations";
import type { MarketingContent } from "./types";

export const SMART_UPLOAD_FINALIZE_KEY_INDEX = "marketing_content_smart_upload_finalize_key_uq";

export class SmartUploadFinalizeKeyConflictError extends Error {
  readonly code = "SMART_UPLOAD_FINALIZE_KEY_CONFLICT";

  constructor(
    readonly finalizeKey: string,
    readonly platform: string,
  ) {
    super(`Smart Upload finalize key already used for ${platform}.`);
    this.name = "SmartUploadFinalizeKeyConflictError";
  }
}

export function isSmartUploadFinalizeKeyConflict(error: unknown): boolean {
  if (error instanceof SmartUploadFinalizeKeyConflictError) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; constraint?: string; message?: string };
  if (record.code === "23505") {
    const constraint = String(record.constraint ?? "");
    const message = String(record.message ?? "");
    if (constraint.includes("smart_upload_finalize") || message.includes("smart_upload_finalize")) {
      return true;
    }
    if (message.includes("marketing_content_smart_upload_finalize_key_uq")) {
      return true;
    }
  }
  return false;
}

export type SmartUploadFinalizeLookup =
  | { status: "none" }
  | {
      status: "complete";
      destinations: SmartUploadDestinations;
      instagram: MarketingContent | null;
      facebook: MarketingContent | null;
      pinterest: MarketingContent | null;
      assetId: string;
    }
  | {
      status: "partial";
      destinations: SmartUploadDestinations;
      instagram: MarketingContent | null;
      facebook: MarketingContent | null;
      pinterest: MarketingContent | null;
      assetId: string;
    }
  | { status: "inconsistent"; reason: string };

function expectedDestinationsFromRows(tagged: MarketingContent[]): SmartUploadDestinations {
  const fromMeta = tagged.find((row) => row.metadata?.smartUploadDestinations)?.metadata
    ?.smartUploadDestinations;
  if (fromMeta) return normalizeSmartUploadDestinations(fromMeta);
  const hasInstagram = tagged.some((row) => row.platform === "instagram");
  const hasFacebook = tagged.some((row) => row.platform === "facebook");
  const hasPinterest = tagged.some((row) => row.platform === "pinterest");
  if (hasFacebook && !hasInstagram && !hasPinterest) {
    return normalizeSmartUploadDestinations({
      facebook: true,
      instagram: false,
      pinterest: false,
    });
  }
  return normalizeSmartUploadDestinations({
    facebook: hasFacebook || hasInstagram,
    instagram: hasInstagram || hasFacebook,
    pinterest: hasPinterest,
  });
}

export function assertSmartUploadPlatformSlotAvailable(
  finalizeKey: string,
  lookup: SmartUploadFinalizeLookup,
  platform: string,
): void {
  if (lookup.status === "inconsistent") {
    throw new Error(lookup.reason);
  }
  if (lookup.status === "none") return;
  if (lookup.status === "complete") {
    throw new SmartUploadFinalizeKeyConflictError(finalizeKey, platform);
  }
  const occupied =
    (platform === "instagram" && lookup.instagram) ||
    (platform === "facebook" && lookup.facebook) ||
    (platform === "pinterest" && lookup.pinterest);
  if (occupied) {
    throw new SmartUploadFinalizeKeyConflictError(finalizeKey, platform);
  }
}

function primaryAssetIdFromRows(
  instagram: MarketingContent | undefined,
  facebook: MarketingContent | undefined,
  pinterest: MarketingContent | undefined,
): string {
  return (
    instagram?.assetIds[0] ??
    facebook?.assetIds[0] ??
    pinterest?.assetIds[0] ??
    ""
  );
}

export function parseSmartUploadFinalizeRows(
  rows: MarketingContent[],
  finalizeKey: string,
): SmartUploadFinalizeLookup {
  const tagged = rows.filter(
    (row) =>
      row.metadata?.source === SMART_UPLOAD_SOURCE &&
      row.metadata?.smartUploadFinalizeKey === finalizeKey,
  );

  const instagramRows = tagged.filter((row) => row.platform === "instagram");
  const facebookRows = tagged.filter((row) => row.platform === "facebook");
  const pinterestRows = tagged.filter((row) => row.platform === "pinterest");

  if (instagramRows.length > 1 || facebookRows.length > 1 || pinterestRows.length > 1) {
    return {
      status: "inconsistent",
      reason: "Multiple Smart Upload content rows exist for the same finalize key and platform.",
    };
  }

  const instagram = instagramRows[0] ?? null;
  const facebook = facebookRows[0] ?? null;
  const pinterest = pinterestRows[0] ?? null;

  if (!instagram && !facebook && !pinterest) {
    return { status: "none" };
  }

  const destinations = expectedDestinationsFromRows(tagged);
  const assetId = primaryAssetIdFromRows(instagram ?? undefined, facebook ?? undefined, pinterest ?? undefined);

  if ((instagram || facebook || pinterest) && !assetId) {
    return {
      status: "inconsistent",
      reason: "Smart Upload row is missing an asset reference.",
    };
  }

  const missing: string[] = [];
  if (destinations.instagram && !instagram) missing.push("instagram");
  if (destinations.facebook && !facebook) missing.push("facebook");
  if (destinations.pinterest && !pinterest) missing.push("pinterest");

  if (missing.length > 0) {
    return {
      status: "partial",
      destinations,
      instagram,
      facebook,
      pinterest,
      assetId,
    };
  }

  return {
    status: "complete",
    destinations,
    instagram,
    facebook,
    pinterest,
    assetId,
  };
}

export function smartUploadFinalizeKeyForContent(content: MarketingContent): string | null {
  if (content.metadata?.source !== SMART_UPLOAD_SOURCE) return null;
  const key = content.metadata?.smartUploadFinalizeKey?.trim();
  return key || null;
}
