import type { MarketingNotificationPayload } from "../notifications/types";
import { logMarketing } from "../logger";
import {
  attachReliabilityDedupeNotification,
  claimReliabilityDedupe,
  releaseReliabilityDedupe,
} from "../reliability/repository";
import { publicationAmbiguousOutcomeDedupeKey } from "../reliability/dedupe-keys";
import { notifyReliabilityPayload } from "../reliability/notify";
import { formatPlatformLabel } from "../reliability/format";
import type { MarketingPublication } from "../types";
import {
  isPersistedProviderCreationId,
  isProviderInflightMarker,
} from "./provider-inflight";

export function buildAmbiguousOutcomeNotificationPayload(
  publication: MarketingPublication,
  detail?: string,
): MarketingNotificationPayload {
  const platform = formatPlatformLabel(publication.platform);
  const hint = detail?.trim() ? ` ${detail.trim()}` : "";
  let evidenceHint = "";
  if (isPersistedProviderCreationId(publication.providerCreationId)) {
    evidenceHint = " Provider container/id preserved for later reconciliation.";
  } else if (isProviderInflightMarker(publication.providerCreationId)) {
    evidenceHint =
      " Provider publish was in-flight when the outcome became ambiguous (not a stored container id).";
  }
  return {
    type: "publication_ambiguous",
    severity: "error",
    title: `${platform} publish outcome is ambiguous`,
    body:
      `Automatic Meta retry is blocked until the outcome is verified.${hint}${evidenceHint} ` +
      `Investigate in Marketing Admin before retrying manually.`,
    destination: "/admin/marketing/week",
    relatedContentId: publication.contentId,
    relatedPublicationId: publication.id,
  };
}

export type AmbiguousOutcomeNotificationDeps = {
  claimDedupe: (input: { dedupeKey: string; publicationId: string }) => Promise<boolean>;
  notify: (
    payload: MarketingNotificationPayload,
  ) => Promise<{ notificationId: string; pushDelivered: number }>;
  attachDedupe: (input: { dedupeKey: string; notificationId: string }) => Promise<void>;
  releaseDedupe: (dedupeKey: string) => Promise<void>;
};

const defaultAmbiguousOutcomeNotificationDeps: AmbiguousOutcomeNotificationDeps = {
  claimDedupe: claimReliabilityDedupe,
  notify: notifyReliabilityPayload,
  attachDedupe: attachReliabilityDedupeNotification,
  releaseDedupe: releaseReliabilityDedupe,
};

let ambiguousOutcomeNotifyInvocationCount = 0;

/** Test-only: count entries into the outcome notification path. */
export function resetAmbiguousOutcomeNotifyInvocationCountForTests(): void {
  ambiguousOutcomeNotifyInvocationCount = 0;
}

export function getAmbiguousOutcomeNotifyInvocationCountForTests(): number {
  return ambiguousOutcomeNotifyInvocationCount;
}

/**
 * Sends deduplicated owner notification. Failures are logged only — never triggers Meta retry.
 */
export async function notifyPublicationAmbiguousOutcomeWithDeps(
  publication: MarketingPublication,
  detail?: string,
  deps: AmbiguousOutcomeNotificationDeps = defaultAmbiguousOutcomeNotificationDeps,
): Promise<void> {
  ambiguousOutcomeNotifyInvocationCount += 1;
  const payload = buildAmbiguousOutcomeNotificationPayload(publication, detail);
  const dedupeKey = publicationAmbiguousOutcomeDedupeKey(publication.id);
  try {
    const claimed = await deps.claimDedupe({
      dedupeKey,
      publicationId: publication.id,
    });
    if (!claimed) return;
    try {
      const { notificationId } = await deps.notify(payload);
      await deps.attachDedupe({ dedupeKey, notificationId });
    } catch (error) {
      await deps.releaseDedupe(dedupeKey);
      logMarketing({
        operation: "publication_ambiguous_notify",
        contentId: publication.contentId,
        success: false,
        error: error instanceof Error ? error.message : "notify failed",
      });
    }
  } catch (error) {
    logMarketing({
      operation: "publication_ambiguous_notify",
      contentId: publication.contentId,
      success: false,
      error: error instanceof Error ? error.message : "notify failed",
    });
  }
}

export async function notifyPublicationAmbiguousOutcome(
  publication: MarketingPublication,
  detail?: string,
): Promise<void> {
  return notifyPublicationAmbiguousOutcomeWithDeps(publication, detail);
}
