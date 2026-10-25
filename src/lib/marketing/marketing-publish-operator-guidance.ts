import type { PreflightErrorCode } from "./publish-preflight";

const PREFLIGHT_RECOVERY: Partial<Record<PreflightErrorCode, string>> = {
  tracking_link_required:
    "Fix tracking on Your Week or the content queue: approve weekly rows that mint tokens, or restore a tracking token before scheduling or retrying publish.",
  destination_path_invalid:
    "Set a valid on-site destination (known book page, blog slug, free resource, or homepage mapping). Reject invalid metadata.websiteDestinationPath overrides.",
  image_missing:
    "Attach an approved catalog image to this row, or upload and approve a new asset in Smart Upload before scheduling.",
  image_unreadable:
    "Re-upload the image or refresh asset metadata so width and height can be read; broken URLs block publish.",
  invalid_aspect_ratio:
    "Replace or crop the visual to match this channel's aspect ratio rules, then re-approve the asset.",
  invalid_asset:
    "Resolve asset configuration (HTTPS public URL, Pinterest credentials, or pin title/description) before retrying.",
  unsupported_platform_asset:
    "This format is not supported for the selected platform; change format or platform before publish.",
  asset_not_ready:
    "Clear the “needs new asset” flag only after a new approved image is linked to this content.",
};

export function preflightRecoveryHint(code: PreflightErrorCode): string | null {
  return PREFLIGHT_RECOVERY[code] ?? null;
}

export function formatPreflightErrorWithRecovery(
  code: PreflightErrorCode,
  message: string,
): string {
  const hint = preflightRecoveryHint(code);
  if (!hint) return `${code}: ${message}`;
  return `${code}: ${message} Recovery: ${hint}`;
}

/** Preflight failures must be remediated before automatic or admin retry will succeed. */
export function preflightBlocksPublicationRetry(code: PreflightErrorCode): boolean {
  return (
    code === "tracking_link_required"
    || code === "destination_path_invalid"
    || code === "image_missing"
    || code === "image_unreadable"
    || code === "invalid_aspect_ratio"
    || code === "invalid_asset"
    || code === "unsupported_platform_asset"
    || code === "asset_not_ready"
  );
}

export function duplicatePublishSafeguardMessage(): string {
  return (
    "If Meta or Pinterest already shows this post live, do not retry publish — verify the external post ID first. " +
    "Retries are for confirmed failures only; duplicate retries can create a second live post."
  );
}

export function partialPublicationFailureOperatorGuidance(
  publishedPlatform: string,
  failedPlatform: string,
): string {
  return (
    `${publishedPlatform} published successfully; ${failedPlatform} did not. ` +
    "Do not reschedule the whole batch blindly — open the failed leg on Your Week, fix preflight issues (tracking, image, credentials), " +
    "then use a single-platform retry only after confirming the published leg is correct. " +
    duplicatePublishSafeguardMessage()
  );
}

export function incidentPreflightOperatorNote(errorCode: string): string | null {
  if (errorCode === "tracking_link_required" || errorCode === "destination_path_invalid") {
    return preflightRecoveryHint(errorCode as PreflightErrorCode);
  }
  if (errorCode === "partial_publication_failure") {
    return (
      "Treat each platform leg independently. Fix the failed leg's content before retry; never assume the published leg needs republishing."
    );
  }
  return null;
}
