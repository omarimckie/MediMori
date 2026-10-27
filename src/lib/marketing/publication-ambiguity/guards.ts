import {
  INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
  isInstagramProviderMediaRecoveryRequired,
} from "../publication-recovery-guard";
import type { MarketingPublication } from "../types";
import { PUBLICATION_STALE_PROCESSING_MS } from "./constants";
import { isPersistedProviderCreationId } from "./provider-inflight";
import { isPublicationAmbiguityBlocked } from "./types";

export function isPublicationBlockedForAutomaticMetaRetry(
  publication: Pick<
    MarketingPublication,
    "ambiguityState" | "providerCreationId" | "status"
  >,
): boolean {
  if (isPublicationAmbiguityBlocked(publication.ambiguityState)) {
    return true;
  }
  if (isPersistedProviderCreationId(publication.providerCreationId)) {
    return true;
  }
  return false;
}

export function isPublicationStaleProcessing(
  publication: Pick<MarketingPublication, "status" | "updatedAt" | "processingStartedAt">,
  now = Date.now(),
): boolean {
  if (publication.status !== "processing") return false;
  const anchor = publication.processingStartedAt ?? publication.updatedAt;
  const started = new Date(anchor).getTime();
  if (!Number.isFinite(started)) return false;
  return now - started >= PUBLICATION_STALE_PROCESSING_MS;
}

export function publicationRetryBlockedReason(
  publication: MarketingPublication,
): string | null {
  if (isInstagramProviderMediaRecoveryRequired(publication)) {
    return INSTAGRAM_PROVIDER_RECOVERY_MESSAGE;
  }
  if (publication.status === "processing") {
    return "Publication is still processing. Retry is blocked to avoid duplicate posts.";
  }
  if (publication.ambiguityState === "ambiguous") {
    return "Publication outcome is ambiguous. Verify on Meta before retrying.";
  }
  if (publication.ambiguityState === "owner_required") {
    return "Publication requires owner review before retry.";
  }
  return null;
}
