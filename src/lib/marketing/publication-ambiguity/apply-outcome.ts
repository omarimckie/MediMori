import type { MarketingStore } from "../store";
import type { MarketingPublication } from "../types";
import {
  formatPublicationFailureLastError,
  shouldStampCronAutoRetryForPlatform,
} from "../publication-cron-retry";
import type { PublishOutcomeClass } from "./classify";
import { ambiguityStateForOutcome } from "./classify";
import { recordPublicationAmbiguousOutcomeIncident } from "../publication-incidents/ambiguous";
import {
  isPersistedProviderCreationId,
  isProviderInflightMarker,
} from "./provider-inflight";

function providerCreationIdAfterFailure(publication: MarketingPublication): string | null {
  if (isProviderInflightMarker(publication.providerCreationId)) {
    return null;
  }
  const persistedId = publication.providerCreationId;
  if (isPersistedProviderCreationId(persistedId)) {
    return persistedId as string;
  }
  return publication.providerCreationId ?? null;
}

export async function applyConfirmedPublicationFailure(
  store: MarketingStore,
  input: {
    publication: MarketingPublication;
    claimToken: string;
    attemptCount: number;
    lastError: string;
    cronAutoRetry: boolean;
    platform: string;
    providerRetryable: boolean;
  },
): Promise<MarketingPublication | null> {
  const lastError = formatPublicationFailureLastError(
    input.lastError,
    input.cronAutoRetry &&
      shouldStampCronAutoRetryForPlatform(input.platform, input.providerRetryable),
  );
  return store.finalizePublicationClaim({
    id: input.publication.id,
    claimToken: input.claimToken,
    patch: {
      status: "failed",
      attemptCount: input.attemptCount,
      lastError,
      ambiguityState: "none",
      claimToken: null,
      processingStartedAt: null,
      providerCreationId: providerCreationIdAfterFailure(input.publication),
    },
  });
}

export async function applyAmbiguousPublicationOutcome(
  store: MarketingStore,
  input: {
    publication: MarketingPublication;
    claimToken: string;
    attemptCount: number;
    lastError: string;
    ownerRequired?: boolean;
    notifyDetail?: string;
  },
): Promise<MarketingPublication | null> {
  const ambiguityState = input.ownerRequired ? "owner_required" : "ambiguous";
  const updated = await store.finalizePublicationClaim({
    id: input.publication.id,
    claimToken: input.claimToken,
    patch: {
      status: "failed",
      attemptCount: input.attemptCount,
      lastError: formatPublicationFailureLastError(input.lastError, false),
      ambiguityState,
      claimToken: null,
      processingStartedAt: null,
      providerCreationId: providerCreationIdAfterFailure(input.publication),
    },
  });
  if (updated && updated.ambiguityState !== "none") {
    await recordPublicationAmbiguousOutcomeIncident(updated, {
      notifyDetail: input.notifyDetail,
    });
  }
  return updated;
}

export async function applySuccessfulPublication(
  store: MarketingStore,
  input: {
    publication: MarketingPublication;
    claimToken: string;
    attemptCount: number;
    externalId: string | null | undefined;
    url: string | null | undefined;
    publishedAt: string;
  },
): Promise<MarketingPublication | null> {
  return store.finalizePublicationClaim({
    id: input.publication.id,
    claimToken: input.claimToken,
    patch: {
      status: "published",
      externalId: input.externalId ?? input.publication.externalId,
      url: input.url ?? input.publication.url,
      attemptCount: input.attemptCount,
      lastError: null,
      publishedAt: input.publishedAt,
      ambiguityState: "none",
      claimToken: null,
      processingStartedAt: null,
      providerCreationId: null,
    },
  });
}

export function outcomeToAmbiguityState(outcome: PublishOutcomeClass) {
  return ambiguityStateForOutcome(outcome);
}
