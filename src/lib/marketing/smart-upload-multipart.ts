import {
  normalizeSmartUploadDestinations,
  parseSmartUploadDestinationsRecord,
  type SmartUploadDestinations,
} from "./smart-upload-destinations";
import {
  isSmartUploadSubmissionReady,
  metaImageNeedsAspectFix,
  pinterestImageNeedsAspectFix,
  type SmartUploadUiValidationIssue,
} from "./smart-upload-ui-readiness";

export function parseSmartUploadDestinationsFormValue(
  value: FormDataEntryValue | null,
): SmartUploadDestinations {
  if (typeof value !== "string" || !value.trim()) {
    return normalizeSmartUploadDestinations(null);
  }
  try {
    return parseSmartUploadDestinationsRecord(JSON.parse(value) as Record<string, unknown>);
  } catch {
    throw new Error("Invalid destinations payload.");
  }
}

export function localMultipartSmartUploadBlobRequiredMessage(): string {
  return "Smart Upload needs Vercel Blob storage for Pinterest or separate Meta/Pinterest image versions. Configure BLOB_READ_WRITE_TOKEN for local dev, then upload again.";
}

export type LocalMultipartFinalizeSnapshot = {
  acceptedMetaPreview: boolean;
  acceptedPinterestPreview: boolean;
  validationIssues: SmartUploadUiValidationIssue[];
};

/**
 * Multipart finalize uses one in-memory image buffer. Block when blob-staged derivatives
 * are required or when selected destinations are not submission-ready.
 */
export function localMultipartSmartUploadFinalizeBlockedReason(
  destinations: SmartUploadDestinations,
  snapshot: LocalMultipartFinalizeSnapshot,
): string | null {
  if (snapshot.acceptedMetaPreview || snapshot.acceptedPinterestPreview) {
    return localMultipartSmartUploadBlobRequiredMessage();
  }
  if (
    metaImageNeedsAspectFix(
      destinations,
      snapshot.validationIssues,
      snapshot.acceptedMetaPreview,
    ) ||
    pinterestImageNeedsAspectFix(
      destinations,
      snapshot.validationIssues,
      snapshot.acceptedPinterestPreview,
    )
  ) {
    return localMultipartSmartUploadBlobRequiredMessage();
  }
  if (
    !isSmartUploadSubmissionReady(
      destinations,
      snapshot.validationIssues,
      snapshot.acceptedMetaPreview,
      snapshot.acceptedPinterestPreview,
    )
  ) {
    return "Fix image validation for all selected platforms before submitting.";
  }
  return null;
}
