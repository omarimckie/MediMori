import { smartUploadCaptionErrorStatus } from "../smart-upload-caption-api";
import { smartUploadErrorStatus } from "../smart-upload-api";
import type { SmartUploadValidationIssue } from "../smart-upload";

export function isSmartUploadCaptionOperationalFailure(error: unknown): boolean {
  const status = smartUploadCaptionErrorStatus(error);
  return status === 502 || status === 500;
}

export function isSmartUploadFinalizeOperationalFailure(
  error: unknown,
): boolean {
  if (error && typeof error === "object" && "validationIssues" in error) {
    const issues = (error as { validationIssues?: SmartUploadValidationIssue[] })
      .validationIssues;
    if (Array.isArray(issues) && issues.length > 0) {
      return false;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (smartUploadErrorStatus(message) === 400) {
    return false;
  }
  return smartUploadErrorStatus(message) >= 500;
}
