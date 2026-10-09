import {
  metaDestinationsSelected,
  type SmartUploadDestinations,
} from "./smart-upload-destinations";

export type SmartUploadUiValidationIssue = {
  code: string;
  message: string;
  platform?: string;
};

function isMetaPlatform(platform: string | undefined): boolean {
  return platform === "instagram" || platform === "facebook";
}

export function metaValidationIssues(issues: SmartUploadUiValidationIssue[]): SmartUploadUiValidationIssue[] {
  return issues.filter((issue) => isMetaPlatform(issue.platform));
}

export function pinterestValidationIssues(
  issues: SmartUploadUiValidationIssue[],
): SmartUploadUiValidationIssue[] {
  return issues.filter((issue) => issue.platform === "pinterest");
}

export function onlyAspectRatioIssues(issues: SmartUploadUiValidationIssue[]): boolean {
  if (!issues.length) return false;
  return issues.every((issue) => issue.code === "invalid_aspect_ratio");
}

export function isMetaImageReady(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedMetaPreview: boolean,
): boolean {
  if (!metaDestinationsSelected(destinations)) return true;
  if (acceptedMetaPreview) return true;
  return metaValidationIssues(validationIssues).length === 0;
}

export function isPinterestImageReady(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedPinterestPreview: boolean,
): boolean {
  if (!destinations.pinterest) return true;
  if (acceptedPinterestPreview) return true;
  return pinterestValidationIssues(validationIssues).length === 0;
}

export function isSmartUploadSubmissionReady(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedMetaPreview: boolean,
  acceptedPinterestPreview: boolean,
): boolean {
  if (!onlyAspectRatioIssues(validationIssues) && validationIssues.length > 0) {
    return false;
  }
  return (
    isMetaImageReady(destinations, validationIssues, acceptedMetaPreview) &&
    isPinterestImageReady(destinations, validationIssues, acceptedPinterestPreview)
  );
}

export function metaImageNeedsAspectFix(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedMetaPreview: boolean,
): boolean {
  if (!metaDestinationsSelected(destinations)) return false;
  if (acceptedMetaPreview) return false;
  const metaIssues = metaValidationIssues(validationIssues);
  return metaIssues.length > 0 && metaIssues.every((i) => i.code === "invalid_aspect_ratio");
}

export function pinterestImageNeedsAspectFix(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedPinterestPreview: boolean,
): boolean {
  if (!destinations.pinterest) return false;
  if (acceptedPinterestPreview) return false;
  const pinIssues = pinterestValidationIssues(validationIssues);
  return pinIssues.length > 0 && pinIssues.every((i) => i.code === "invalid_aspect_ratio");
}

export function deriveUploadStatusAfterValidation(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedMetaPreview: boolean,
  acceptedPinterestPreview: boolean,
): "ready" | "needs_attention" {
  if (!validationIssues.length) return "ready";
  if (
    isSmartUploadSubmissionReady(
      destinations,
      validationIssues,
      acceptedMetaPreview,
      acceptedPinterestPreview,
    )
  ) {
    return "ready";
  }
  return "needs_attention";
}

export function isCaptionImagePreparationReady(
  destinations: SmartUploadDestinations,
  validationIssues: SmartUploadUiValidationIssue[],
  acceptedMetaPreview: boolean,
): boolean {
  if (!metaDestinationsSelected(destinations)) {
    return onlyAspectRatioIssues(validationIssues) || validationIssues.length === 0;
  }
  return isMetaImageReady(destinations, validationIssues, acceptedMetaPreview);
}

export function validationIssuesAfterAcceptingMetaFix(
  issues: SmartUploadUiValidationIssue[],
): SmartUploadUiValidationIssue[] {
  return issues.filter((issue) => !isMetaPlatform(issue.platform));
}

export function validationIssuesAfterAcceptingPinterestFix(
  issues: SmartUploadUiValidationIssue[],
): SmartUploadUiValidationIssue[] {
  return issues.filter((issue) => issue.platform !== "pinterest");
}
