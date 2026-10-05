import type {
  SmartUploadFixStrategy,
  SmartUploadFixTargetRatio,
} from "./smart-upload-fix";
import {
  parseSmartUploadFixStrategy,
  parseSmartUploadFixTargetRatio,
} from "./smart-upload-fix";
import type { SmartUploadPlatformCaptions, SmartUploadValidationIssue } from "./smart-upload";

export type SmartUploadStagedBlobRef = {
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
};

export function parseSmartUploadStagedBlobRef(
  record: Record<string, unknown>,
  prefix = "",
): SmartUploadStagedBlobRef {
  const p = prefix ? `${prefix}` : "";
  const uploadIntent = String(record[`${p}uploadIntent`] ?? record.uploadIntent ?? "").trim();
  const pathname = String(record[`${p}pathname`] ?? record.pathname ?? "").trim();
  const publicUrl = String(record[`${p}publicUrl`] ?? record.publicUrl ?? "").trim();
  if (!uploadIntent || !pathname || !publicUrl) {
    throw new Error(`${prefix ? `${prefix} ` : ""}uploadIntent, pathname, and publicUrl are required.`);
  }
  return { uploadIntent, pathname, publicUrl };
}

export function parseSmartUploadFinalizeBody(record: Record<string, unknown>): {
  caption: string;
  facebookCaption: string | null;
  instagramCaption: string | null;
  batchId: string;
  finalizeKey: string;
  weeklyPlanId: string | null;
  campaignId: string | null;
  category?: string;
  audience?: string;
  bookId: string | null;
  uploadIntent?: string;
  pathname?: string;
  publicUrl?: string;
  imageFilename?: string;
  fix?: {
    strategy: SmartUploadFixStrategy;
    targetRatio: SmartUploadFixTargetRatio;
    original: SmartUploadStagedBlobRef;
  };
} {
  const caption = String(record.caption ?? "").trim();
  const facebookCaption = String(record.facebookCaption ?? "").trim() || null;
  const instagramCaption = String(record.instagramCaption ?? "").trim() || null;
  const batchId = String(record.batchId ?? "").trim();
  const finalizeKey = String(record.finalizeKey ?? "").trim();
  if (!batchId) throw new Error("batchId is required.");
  if (!finalizeKey) throw new Error("finalizeKey is required.");

  const weeklyPlanId = String(record.weeklyPlanId ?? "").trim() || null;
  const campaignId = String(record.campaignId ?? "").trim() || null;
  const bookId = String(record.bookId ?? "").trim() || null;

  const uploadIntent = String(record.uploadIntent ?? "").trim() || undefined;
  const pathname = String(record.pathname ?? "").trim() || undefined;
  const publicUrl = String(record.publicUrl ?? "").trim() || undefined;
  const imageFilename = String(record.imageFilename ?? "").trim() || undefined;

  const strategyRaw = String(record.smartUploadFixStrategy ?? "").trim();
  const targetRaw = String(record.smartUploadFixTargetRatio ?? "").trim();
  const originalIntent = String(record.originalUploadIntent ?? "").trim();
  const originalPath = String(record.originalPathname ?? "").trim();
  const originalUrl = String(record.originalPublicUrl ?? "").trim();

  let fix:
    | {
        strategy: SmartUploadFixStrategy;
        targetRatio: SmartUploadFixTargetRatio;
        original: SmartUploadStagedBlobRef;
      }
    | undefined;

  if (strategyRaw || targetRaw || originalIntent || originalPath || originalUrl) {
    if (!strategyRaw || !targetRaw || !originalIntent || !originalPath || !originalUrl) {
      throw new Error(
        "Fixed finalize requires smartUploadFixStrategy, smartUploadFixTargetRatio, originalUploadIntent, originalPathname, and originalPublicUrl.",
      );
    }
    if (!uploadIntent || !pathname || !publicUrl) {
      throw new Error("Derivative uploadIntent, pathname, and publicUrl are required for fixed finalize.");
    }
    fix = {
      strategy: parseSmartUploadFixStrategy(strategyRaw),
      targetRatio: parseSmartUploadFixTargetRatio(targetRaw),
      original: {
        uploadIntent: originalIntent,
        pathname: originalPath,
        publicUrl: originalUrl,
      },
    };
  }

  if (facebookCaption || instagramCaption) {
    if (!facebookCaption || !instagramCaption) {
      throw new Error("facebookCaption and instagramCaption must both be provided.");
    }
  }

  return {
    caption,
    facebookCaption,
    instagramCaption,
    batchId,
    finalizeKey,
    weeklyPlanId,
    campaignId,
    bookId,
    category: record.category ? String(record.category) : undefined,
    audience: record.audience ? String(record.audience) : undefined,
    uploadIntent,
    pathname,
    publicUrl,
    imageFilename,
    fix,
  };
}

export function parseSmartUploadPreviewFixBody(record: Record<string, unknown>): {
  finalizeKey: string;
  original: SmartUploadStagedBlobRef;
  strategy: SmartUploadFixStrategy;
  targetRatio: SmartUploadFixTargetRatio;
  imageFilename?: string;
} {
  const finalizeKey = String(record.finalizeKey ?? "").trim();
  if (!finalizeKey) throw new Error("finalizeKey is required.");
  const original = parseSmartUploadStagedBlobRef(record, "");
  const strategy = parseSmartUploadFixStrategy(String(record.strategy ?? ""));
  const targetRatio = parseSmartUploadFixTargetRatio(String(record.targetRatio ?? ""));
  const imageFilename = String(record.imageFilename ?? "").trim() || undefined;
  return { finalizeKey, original, strategy, targetRatio, imageFilename };
}

export function parseSmartUploadDiscardPreviewBody(record: Record<string, unknown>): SmartUploadStagedBlobRef {
  return parseSmartUploadStagedBlobRef(record, "");
}

export function resolveParsedSmartUploadFinalizeCaptions(parsed: {
  caption: string;
  facebookCaption: string | null;
  instagramCaption: string | null;
}): { caption: string; platformCaptions?: SmartUploadPlatformCaptions } {
  if (parsed.facebookCaption && parsed.instagramCaption) {
    return {
      caption: "",
      platformCaptions: {
        facebook: parsed.facebookCaption,
        instagram: parsed.instagramCaption,
      },
    };
  }
  return { caption: parsed.caption };
}

export function smartUploadErrorStatus(message: string): number {
  if (/Unauthorized/i.test(message)) return 401;
  if (
    /validation|aspect|Unsupported|exceeds|Invalid image|Caption|required|not found|Unknown|too large|too many pixels|Transformed/i.test(
      message,
    )
  ) {
    return 400;
  }
  return 500;
}

export function validationIssuesFromError(error: unknown): SmartUploadValidationIssue[] | undefined {
  if (error && typeof error === "object" && "validationIssues" in error) {
    const issues = (error as { validationIssues?: SmartUploadValidationIssue[] }).validationIssues;
    if (Array.isArray(issues) && issues.length > 0) return issues;
  }
  return undefined;
}
