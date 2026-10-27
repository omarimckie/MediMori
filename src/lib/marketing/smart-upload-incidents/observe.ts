import { isSmartUploadFinalizeKeyConflict } from "../smart-upload-idempotency";
import {
  isSmartUploadCaptionOperationalFailure,
  isSmartUploadFinalizeOperationalFailure,
} from "./operational-errors";
import {
  recordSmartUploadCaptionFailedIncident,
  recordSmartUploadFinalizeFailedIncident,
} from "./record";

export async function observeSmartUploadCaptionFailure(
  input: {
    finalizeKey?: string | null;
    mode?: string | null;
    sourceOperation: string;
  },
  error: unknown,
): Promise<void> {
  const finalizeKey = input.finalizeKey?.trim();
  if (!finalizeKey || !isSmartUploadCaptionOperationalFailure(error)) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  await recordSmartUploadCaptionFailedIncident({
    finalizeKey,
    sourceOperation: input.sourceOperation,
    errorMessage: message,
    evidence: {
      caption_mode: input.mode ?? null,
    },
  });
}

export async function observeSmartUploadFinalizeFailure(
  input: {
    finalizeKey: string;
    batchId?: string | null;
    sourceOperation: string;
  },
  error: unknown,
): Promise<void> {
  if (isSmartUploadFinalizeKeyConflict(error)) {
    return;
  }
  if (!isSmartUploadFinalizeOperationalFailure(error)) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  await recordSmartUploadFinalizeFailedIncident({
    finalizeKey: input.finalizeKey,
    batchId: input.batchId,
    sourceOperation: input.sourceOperation,
    errorMessage: message,
  });
}
