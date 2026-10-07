import { isPublicationEligibleForCronAutoRetry } from "../publication-cron-retry";
import { isPublicationBlockedForAutomaticMetaRetry } from "../publication-ambiguity/guards";
import { isPublicationAmbiguityBlocked } from "../publication-ambiguity/types";
import {
  isInstagramProviderMediaRecoveryRequired,
} from "../publication-recovery-guard";
import type { MarketingPublication } from "../types";
import { parsePublicationErrorClass } from "./evidence";

const CREDENTIAL_ERROR_CLASSES = new Set([
  "meta_credentials_missing",
  "meta_auth_expired",
  "meta_permissions",
]);

export function isCredentialClassPublicationError(errorClass: string): boolean {
  return CREDENTIAL_ERROR_CLASSES.has(errorClass);
}

/**
 * Mirrors publishDue failed-queue eligibility: cron will still auto-retry this row.
 */
export function isPublicationEligibleForAutomaticCronRetry(
  publication: Pick<
    MarketingPublication,
    "status" | "attemptCount" | "lastError" | "ambiguityState" | "providerCreationId"
  >,
): boolean {
  if (publication.status !== "failed") {
    return false;
  }
  return (
    publication.attemptCount < 3 &&
    isPublicationEligibleForCronAutoRetry(publication.lastError, publication) &&
    !isPublicationBlockedForAutomaticMetaRetry(publication)
  );
}

export type PublicationFailedCaptureDecision =
  | { capture: false; reason: string }
  | { capture: true };

/**
 * Whether an authoritative failed publication row should create/re-observe
 * publication_failed (recovery and ambiguity take precedence).
 */
export function evaluatePublicationFailedCapture(
  publication: MarketingPublication,
): PublicationFailedCaptureDecision {
  if (publication.status !== "failed") {
    return { capture: false, reason: "not_failed" };
  }
  if (isInstagramProviderMediaRecoveryRequired(publication)) {
    return { capture: false, reason: "recovery_required" };
  }
  if (isPublicationAmbiguityBlocked(publication.ambiguityState)) {
    return { capture: false, reason: "ambiguity_blocked" };
  }
  const errorClass = parsePublicationErrorClass(publication.lastError);
  if (isCredentialClassPublicationError(errorClass)) {
    return { capture: false, reason: "credential_class" };
  }
  if (isPublicationEligibleForAutomaticCronRetry(publication)) {
    return { capture: false, reason: "cron_retry_still_eligible" };
  }
  return { capture: true };
}
