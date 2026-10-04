import type {
  SmartUploadCaptionMode,
  SmartUploadCaptionModelPayload,
  UsedMedicalClaimModelEntry,
} from "./smart-upload-caption-types";
import { SmartUploadCaptionProviderError } from "./smart-upload-caption-errors";

export const SMART_UPLOAD_CAPTION_MAX_BODY_CHARS = 2200;
export const SMART_UPLOAD_CAPTION_MAX_CTA_CHARS = 500;
export const SMART_UPLOAD_CAPTION_MAX_HASHTAG_ITEMS = 32;
export const SMART_UPLOAD_CAPTION_MAX_USED_MEDICAL_CLAIMS = 16;

function assertStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} must be non-empty.`);
  }
  if (trimmed.length > SMART_UPLOAD_CAPTION_MAX_BODY_CHARS) {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} exceeds max length.`);
  }
  return trimmed;
}

function assertOptionalCta(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > SMART_UPLOAD_CAPTION_MAX_CTA_CHARS) {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} exceeds max length.`);
  }
  return trimmed;
}

function assertStringArrayField(value: unknown, fieldName: string, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} must be an array.`);
  }
  if (value.length > maxItems) {
    throw new SmartUploadCaptionProviderError(`Caption model response field ${fieldName} exceeds max items.`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new SmartUploadCaptionProviderError(
        `Caption model response field ${fieldName} must contain only strings.`,
      );
    }
    out.push(item);
  }
  return out;
}

export function parseUsedMedicalClaimsFromModel(value: unknown): UsedMedicalClaimModelEntry[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new SmartUploadCaptionProviderError("Caption model response field usedMedicalClaims must be an array.");
  }
  if (value.length > SMART_UPLOAD_CAPTION_MAX_USED_MEDICAL_CLAIMS) {
    throw new SmartUploadCaptionProviderError("Caption model response field usedMedicalClaims exceeds max items.");
  }
  const out: UsedMedicalClaimModelEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      throw new SmartUploadCaptionProviderError(
        "Caption model response field usedMedicalClaims must contain objects.",
      );
    }
    const record = item as Record<string, unknown>;
    if (typeof record.claimId !== "string" || typeof record.text !== "string") {
      throw new SmartUploadCaptionProviderError(
        "Caption model response usedMedicalClaims entries require claimId and text strings.",
      );
    }
    const claimId = record.claimId.trim();
    const text = record.text.trim();
    if (!claimId || !text) {
      throw new SmartUploadCaptionProviderError(
        "Caption model response usedMedicalClaims entries require non-empty claimId and text.",
      );
    }
    if (text.length > SMART_UPLOAD_CAPTION_MAX_BODY_CHARS) {
      throw new SmartUploadCaptionProviderError("Caption model response usedMedicalClaims text exceeds max length.");
    }
    out.push({ claimId, text });
  }
  return out;
}

export function parseAndValidateModelPayload(
  raw: unknown,
  mode: SmartUploadCaptionMode,
): SmartUploadCaptionModelPayload {
  if (!raw || typeof raw !== "object") {
    throw new SmartUploadCaptionProviderError("Caption model response must be a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== mode) {
    throw new SmartUploadCaptionProviderError("Caption model response mode does not match request.");
  }

  const usedMedicalClaims = parseUsedMedicalClaimsFromModel(record.usedMedicalClaims);

  if (mode === "shared") {
    const sharedBody = assertStringField(record.sharedBody, "sharedBody");
    const sharedCta = assertOptionalCta(record.sharedCta, "sharedCta");
    const instagramHashtags = assertStringArrayField(
      record.instagramHashtags ?? [],
      "instagramHashtags",
      SMART_UPLOAD_CAPTION_MAX_HASHTAG_ITEMS,
    );
    return {
      mode: "shared",
      sharedBody,
      sharedCta,
      instagramHashtags,
      usedMedicalClaims,
    };
  }

  const instagramBody = assertStringField(record.instagramBody, "instagramBody");
  const facebookBody = assertStringField(record.facebookBody, "facebookBody");
  const instagramCta = assertOptionalCta(record.instagramCta, "instagramCta");
  const facebookCta = assertOptionalCta(record.facebookCta, "facebookCta");
  const instagramHashtags = assertStringArrayField(
    record.instagramHashtags ?? [],
    "instagramHashtags",
    SMART_UPLOAD_CAPTION_MAX_HASHTAG_ITEMS,
  );

  return {
    mode: "per_platform",
    instagramBody,
    facebookBody,
    instagramCta,
    facebookCta,
    instagramHashtags,
    usedMedicalClaims,
  };
}
