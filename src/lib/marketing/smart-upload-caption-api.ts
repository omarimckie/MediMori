import type { SmartUploadCaptionBlobRef } from "./smart-upload-caption-security";
import type { SmartUploadCaptionMode } from "./smart-upload-caption-types";
import {
  SmartUploadCaptionGroundingError,
  SmartUploadCaptionProviderError,
} from "./smart-upload-caption-errors";
import type { AudienceId, ContentCategory } from "./types";
import { AUDIENCES, CONTENT_CATEGORIES } from "./types";
import {
  parseSmartUploadFixStrategy,
  parseSmartUploadFixTargetRatio,
  type SmartUploadFixStrategy,
  type SmartUploadFixTargetRatio,
} from "./smart-upload-fix";

function parseSmartUploadCaptionBlobRef(
  uploadIntent: unknown,
  pathname: unknown,
  label: string,
): SmartUploadCaptionBlobRef {
  const intent = String(uploadIntent ?? "").trim();
  const path = String(pathname ?? "").trim();
  if (!intent || !path) {
    throw new Error(`${label} uploadIntent and pathname are required.`);
  }
  return { uploadIntent: intent, pathname: path };
}

export function parseSmartUploadGenerateCaptionsBody(record: Record<string, unknown>): {
  mode: SmartUploadCaptionMode;
  instructions: string | null;
  explicitCta: string | null;
  bookId: string | null;
  campaignId: string | null;
  category: ContentCategory | null;
  audience: AudienceId | null;
  original: SmartUploadCaptionBlobRef;
  acceptedDerivative: SmartUploadCaptionBlobRef | null;
  finalizeKey: string | null;
  strategy: SmartUploadFixStrategy | null;
  targetRatio: SmartUploadFixTargetRatio | null;
} {
  const modeRaw = String(record.mode ?? "shared").trim();
  if (modeRaw !== "shared" && modeRaw !== "per_platform") {
    throw new Error("mode must be shared or per_platform.");
  }
  const mode = modeRaw as SmartUploadCaptionMode;

  const instructions = String(record.instructions ?? "").trim() || null;
  const explicitCta = String(record.explicitCta ?? "").trim() || null;
  const bookId = String(record.bookId ?? "").trim() || null;
  const campaignId = String(record.campaignId ?? "").trim() || null;

  let category: ContentCategory | null = null;
  if (record.category) {
    const raw = String(record.category).trim();
    if (!CONTENT_CATEGORIES.includes(raw as ContentCategory)) {
      throw new Error("Unsupported category.");
    }
    category = raw as ContentCategory;
  }

  let audience: AudienceId | null = null;
  if (record.audience) {
    const raw = String(record.audience).trim();
    if (!AUDIENCES.includes(raw as AudienceId)) {
      throw new Error("Unsupported audience.");
    }
    audience = raw as AudienceId;
  }

  const original = parseSmartUploadCaptionBlobRef(
    record.originalUploadIntent ?? record.uploadIntent,
    record.originalPathname ?? record.pathname,
    "Original",
  );

  const derivativeIntent = String(record.derivativeUploadIntent ?? "").trim();
  const derivativePath = String(record.derivativePathname ?? "").trim();
  let acceptedDerivative: SmartUploadCaptionBlobRef | null = null;
  if (derivativeIntent || derivativePath) {
    if (!derivativeIntent || !derivativePath) {
      throw new Error("derivativeUploadIntent and derivativePathname are required together.");
    }
    acceptedDerivative = parseSmartUploadCaptionBlobRef(derivativeIntent, derivativePath, "Derivative");
  }

  const finalizeKey = String(record.finalizeKey ?? "").trim() || null;
  let strategy: SmartUploadFixStrategy | null = null;
  let targetRatio: SmartUploadFixTargetRatio | null = null;
  if (record.strategy) {
    strategy = parseSmartUploadFixStrategy(String(record.strategy));
  }
  if (record.targetRatio) {
    targetRatio = parseSmartUploadFixTargetRatio(String(record.targetRatio));
  }

  if (acceptedDerivative && (!finalizeKey || !strategy || !targetRatio)) {
    throw new Error(
      "finalizeKey, strategy, and targetRatio are required when derivativeUploadIntent is supplied.",
    );
  }

  return {
    mode,
    instructions,
    explicitCta,
    bookId,
    campaignId,
    category,
    audience,
    original,
    acceptedDerivative,
    finalizeKey,
    strategy,
    targetRatio,
  };
}

export function smartUploadCaptionErrorStatus(error: unknown): number {
  if (error instanceof SmartUploadCaptionGroundingError) return 422;
  if (error instanceof SmartUploadCaptionProviderError) return 502;

  const message = error instanceof Error ? error.message : String(error);
  if (/Unauthorized/i.test(message)) return 401;
  if (/Campaign not found/i.test(message)) return 404;
  if (/OpenAI HTTP|timed out|empty multimodal|not valid JSON/i.test(message)) return 502;
  if (
    /Unknown book|Unsupported|required|intent|expired|Invalid|mode must|match the current admin|does not match|Preview derivative|too large|too many pixels|exceeds.*byte limit/i.test(
      message,
    )
  ) {
    return 400;
  }
  if (/Caption model response/i.test(message)) return 502;
  return 500;
}
