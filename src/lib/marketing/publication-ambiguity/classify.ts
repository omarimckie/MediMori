import type { MetaErrorCode } from "../meta";
import type { PublishResult } from "../publishers";

export type PublishOutcomeClass = "success" | "confirmed_failure" | "ambiguous";

/** Failures that demonstrate Meta did not accept a publish when interaction already started. */
const CONFIRMED_PROVIDER_FAILURE_CODES = new Set<MetaErrorCode | string>([
  "meta_auth_expired",
  "meta_permissions",
  "meta_invalid_image_aspect_ratio",
  "meta_image_missing",
  "meta_image_inaccessible",
  "meta_container_error",
  "meta_container_expired",
  "meta_media_not_ready",
]);

/** Failures clearly before any provider publish API call. */
const CONFIRMED_PRE_PROVIDER_CODES = new Set<MetaErrorCode | string>([
  "meta_credentials_missing",
  "publication_claim_lost",
]);

const AMBIGUOUS_PROVIDER_CODES = new Set<MetaErrorCode | string>([
  "meta_container_status_timeout",
  "meta_container_status_unknown",
  "meta_malformed_response",
  "publication_creation_id_persist_failed",
]);

export function classifyProviderPublishResult(
  result: PublishResult,
  input: { providerInteractionStarted: boolean },
): PublishOutcomeClass {
  if (result.ok) return "success";

  const code = result.errorCode ?? "";
  if (CONFIRMED_PRE_PROVIDER_CODES.has(code)) {
    return "confirmed_failure";
  }
  if (!input.providerInteractionStarted) {
    if (CONFIRMED_PROVIDER_FAILURE_CODES.has(code)) {
      return "confirmed_failure";
    }
    if (result.retryable) {
      return "confirmed_failure";
    }
    return "confirmed_failure";
  }

  if (CONFIRMED_PROVIDER_FAILURE_CODES.has(code)) {
    return "confirmed_failure";
  }
  if (AMBIGUOUS_PROVIDER_CODES.has(code)) {
    return "ambiguous";
  }
  if (code === "meta_http_error" && result.retryable) {
    return "ambiguous";
  }
  if (result.retryable) {
    return "ambiguous";
  }
  if (code === "meta_http_error") {
    return "ambiguous";
  }
  return "confirmed_failure";
}

export function ambiguityStateForOutcome(
  outcome: PublishOutcomeClass,
): "none" | "ambiguous" | "owner_required" {
  if (outcome === "ambiguous") return "ambiguous";
  return "none";
}
