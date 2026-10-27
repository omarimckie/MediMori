import {
  INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
  isInstagramProviderMediaRecoveryRequired,
} from "./publication-recovery-guard";
import type { MarketingPublication } from "./types";

export function contentReviewInstagramRecoveryNotice(
  publication:
    | Pick<
        MarketingPublication,
        "platform" | "status" | "externalId" | "providerCreationId"
      >
    | null
    | undefined,
): string | null {
  if (!publication || !isInstagramProviderMediaRecoveryRequired(publication)) {
    return null;
  }
  return INSTAGRAM_PROVIDER_RECOVERY_MESSAGE;
}
