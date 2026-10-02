import { SMART_UPLOAD_SOURCE } from "./content-metadata";
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
      instagram: MarketingContent;
      facebook: MarketingContent;
      assetId: string;
    }
  | {
      status: "partial";
      instagram: MarketingContent;
      assetId: string;
    }
  | { status: "inconsistent"; reason: string };

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

  if (instagramRows.length > 1 || facebookRows.length > 1) {
    return {
      status: "inconsistent",
      reason: "Multiple Smart Upload content rows exist for the same finalize key and platform.",
    };
  }

  const instagram = instagramRows[0];
  const facebook = facebookRows[0];

  if (facebook && !instagram) {
    return {
      status: "inconsistent",
      reason: "Smart Upload finalize key has Facebook content without Instagram.",
    };
  }

  if (!instagram) {
    return { status: "none" };
  }

  const assetId = instagram.assetIds[0];
  if (!assetId) {
    return {
      status: "inconsistent",
      reason: "Smart Upload Instagram row is missing an asset reference.",
    };
  }

  if (facebook) {
    if (facebook.assetIds[0] !== assetId) {
      return {
        status: "inconsistent",
        reason: "Smart Upload Instagram and Facebook rows reference different assets.",
      };
    }
    return { status: "complete", instagram, facebook, assetId };
  }

  return { status: "partial", instagram, assetId };
}

export function smartUploadFinalizeKeyForContent(content: MarketingContent): string | null {
  if (content.metadata?.source !== SMART_UPLOAD_SOURCE) return null;
  const key = content.metadata?.smartUploadFinalizeKey?.trim();
  return key || null;
}
