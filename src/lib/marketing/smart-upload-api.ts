import type { SmartUploadValidationIssue } from "./smart-upload";

export function parseSmartUploadFinalizeBody(record: Record<string, unknown>): {
  caption: string;
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
} {
  const caption = String(record.caption ?? "").trim();
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

  return {
    caption,
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
  };
}

export function smartUploadErrorStatus(message: string): number {
  if (/Unauthorized/i.test(message)) return 401;
  if (/validation|aspect|Unsupported|exceeds|Invalid image|Caption|required|not found|Unknown/i.test(message)) {
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
