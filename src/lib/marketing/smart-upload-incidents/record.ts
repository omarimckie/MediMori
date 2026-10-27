import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import { sanitizeErrorMessage, sanitizeEvidence } from "../incidents/sanitize";
import type { MarketingIncidentRecord } from "../incidents/types";
import {
  smartUploadCaptionFailedIncidentDedupeKey,
  smartUploadFinalizeFailedIncidentDedupeKey,
} from "../publication-incidents/dedupe-keys";

const SMART_UPLOAD_PERMITTED = ["investigate_read_only", "no_op"] as const;

export async function recordSmartUploadCaptionFailedIncident(input: {
  finalizeKey: string;
  sourceOperation: string;
  errorMessage: string;
  evidence?: Record<string, unknown>;
}): Promise<MarketingIncidentRecord | null> {
  const finalizeKey = input.finalizeKey.trim();
  if (!finalizeKey) {
    return null;
  }
  return recordMarketingIncidentSafely(
    {
      incidentType: "smart_upload_caption_failed",
      status: "open",
      severity: "error",
      sourceOperation: input.sourceOperation,
      dedupeKey: smartUploadCaptionFailedIncidentDedupeKey(finalizeKey),
      errorClass: "smart_upload_caption_failed",
      errorMessage: sanitizeErrorMessage(input.errorMessage),
      retrySafety: "safe_manual",
      permittedActions: [...SMART_UPLOAD_PERMITTED],
      humanApprovalRequired: false,
      finalizeKey,
      evidence: sanitizeEvidence({
        finalize_key: finalizeKey,
        ...input.evidence,
      }),
    },
    { reopenIfResolved: true },
  );
}

export async function recordSmartUploadFinalizeFailedIncident(input: {
  finalizeKey: string;
  batchId?: string | null;
  sourceOperation: string;
  errorMessage: string;
  evidence?: Record<string, unknown>;
}): Promise<MarketingIncidentRecord | null> {
  const finalizeKey = input.finalizeKey.trim();
  if (!finalizeKey) {
    return null;
  }
  return recordMarketingIncidentSafely(
    {
      incidentType: "smart_upload_finalize_failed",
      status: "action_required",
      severity: "error",
      sourceOperation: input.sourceOperation,
      dedupeKey: smartUploadFinalizeFailedIncidentDedupeKey(finalizeKey),
      errorClass: "smart_upload_finalize_failed",
      errorMessage: sanitizeErrorMessage(input.errorMessage),
      retrySafety: "safe_manual",
      permittedActions: [...SMART_UPLOAD_PERMITTED],
      humanApprovalRequired: false,
      finalizeKey,
      batchId: input.batchId?.trim() || null,
      evidence: sanitizeEvidence({
        finalize_key: finalizeKey,
        batch_id: input.batchId?.trim() || null,
        ...input.evidence,
      }),
    },
    { reopenIfResolved: true },
  );
}
