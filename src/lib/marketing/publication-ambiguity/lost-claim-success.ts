import { formatPublicationFailureLastError } from "../publication-cron-retry";
import { logMarketing } from "../logger";
import type { MarketingStore } from "../store";
import type { MarketingPublication } from "../types";
import type { PublishResult } from "../publishers";
import { applySuccessfulPublication } from "./apply-outcome";
import { notifyPublicationAmbiguousOutcome } from "./notify";

/**
 * Generic updatePublication(id) success recovery is forbidden: a stale worker must
 * never overwrite a newer claim or published external_id merely because Meta returned
 * an id to the stale invocation.
 */
export async function handleProviderSuccessAfterLostFinalize(
  store: MarketingStore,
  input: {
    publication: MarketingPublication;
    claimToken: string;
    attemptCount: number;
    result: PublishResult;
    publishedAt: string;
  },
): Promise<MarketingPublication> {
  const authoritative = (await store.getPublication(input.publication.id)) ?? input.publication;

  if (authoritative.status === "published" && authoritative.externalId) {
    return authoritative;
  }

  const retryFinalize = await applySuccessfulPublication(store, {
    publication: input.publication,
    claimToken: input.claimToken,
    attemptCount: input.attemptCount,
    externalId: input.result.externalId,
    url: input.result.url,
    publishedAt: input.publishedAt,
  });
  if (retryFinalize) {
    return retryFinalize;
  }

  const evidenceNote = input.result.externalId
    ? " Meta may have accepted the post; provider external id was not written because the claim was no longer active."
    : "";

  const ambiguous = await store.finalizePublicationClaim({
    id: input.publication.id,
    claimToken: input.claimToken,
    patch: {
      status: "failed",
      attemptCount: input.attemptCount,
      ambiguityState: "ambiguous",
      claimToken: null,
      processingStartedAt: null,
      lastError: formatPublicationFailureLastError(
        `publication_finalize_lost_claim: Provider success could not be finalized safely.${evidenceNote}`,
        false,
      ),
    },
  });

  if (ambiguous) {
    void notifyPublicationAmbiguousOutcome(ambiguous, evidenceNote.trim() || undefined);
    return ambiguous;
  }

  logMarketing({
    operation: "publication_stale_provider_success",
    contentId: authoritative.contentId,
    success: false,
    error: `Provider returned success but claim-aware finalize failed; authoritative row left unchanged (publicationId=${input.publication.id}, hasExternalId=${Boolean(input.result.externalId)}).`,
  });

  return (await store.getPublication(input.publication.id)) ?? authoritative;
}
