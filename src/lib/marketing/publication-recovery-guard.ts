import { isPersistedProviderCreationId } from "./publication-ambiguity/provider-inflight";
import type { MarketingPublication } from "./types";

export const INSTAGRAM_PROVIDER_RECOVERY_MESSAGE =
  "Instagram created media on Meta for this post, but publishing did not finish. " +
  "Owner recovery is required before another publication attempt — normal retry or reschedule would risk duplicate media.";

export function isInstagramProviderMediaRecoveryRequired(
  publication: Pick<
    MarketingPublication,
    "platform" | "status" | "externalId" | "providerCreationId"
  >,
): boolean {
  return (
    publication.platform === "instagram" &&
    publication.status === "failed" &&
    !publication.externalId &&
    isPersistedProviderCreationId(publication.providerCreationId)
  );
}
