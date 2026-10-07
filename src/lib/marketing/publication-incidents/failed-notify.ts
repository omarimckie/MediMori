import type { MarketingNotificationPayload } from "../notifications/types";
import { logMarketing } from "../logger";
import {
  attachReliabilityDedupeNotification,
  claimReliabilityDedupe,
  releaseReliabilityDedupe,
} from "../reliability/repository";
import { notifyReliabilityPayload } from "../reliability/notify";
import { formatPlatformLabel } from "../reliability/format";
import type { MarketingIncidentRecord } from "../incidents/types";
import type { MarketingPublication } from "../types";
import { publicationFailedNotificationDedupeKey } from "./dedupe-keys";

export function buildPublicationFailedNotificationPayload(
  publication: MarketingPublication,
  relatedIncidentId: string,
): MarketingNotificationPayload {
  const platform = formatPlatformLabel(publication.platform);
  return {
    type: "publication_failed",
    severity: "error",
    title: `${platform} publication failed`,
    body:
      "Automatic publication retry is exhausted or unavailable for this post. " +
      "Review the linked incident in Marketing Admin before taking further action.",
    destination: "/admin/marketing/week",
    relatedContentId: publication.contentId,
    relatedPublicationId: publication.id,
    relatedIncidentId,
  };
}

export type PublicationFailedNotifyDeps = {
  claimDedupe: (input: { dedupeKey: string; publicationId: string }) => Promise<boolean>;
  notify: (
    payload: MarketingNotificationPayload,
  ) => Promise<{ notificationId: string; pushDelivered?: number }>;
  attachDedupe: (input: { dedupeKey: string; notificationId: string }) => Promise<void>;
  releaseDedupe: (dedupeKey: string) => Promise<void>;
};

const defaultDeps: PublicationFailedNotifyDeps = {
  claimDedupe: claimReliabilityDedupe,
  notify: notifyReliabilityPayload,
  attachDedupe: attachReliabilityDedupeNotification,
  releaseDedupe: releaseReliabilityDedupe,
};

/**
 * Notifies on created/reopened actionable failure; skips pure occurrence updates.
 */
export async function notifyPublicationFailedWithDeps(
  publication: MarketingPublication,
  incident: MarketingIncidentRecord,
  outcome: "created" | "reopened" | "occurrence",
  deps: PublicationFailedNotifyDeps = defaultDeps,
): Promise<void> {
  if (outcome === "occurrence") {
    return;
  }
  const dedupeKey = publicationFailedNotificationDedupeKey(publication.id);
  const payload = buildPublicationFailedNotificationPayload(publication, incident.id);
  try {
    const claimed = await deps.claimDedupe({
      dedupeKey,
      publicationId: publication.id,
    });
    if (!claimed) {
      return;
    }
    try {
      const { notificationId } = await deps.notify(payload);
      await deps.attachDedupe({ dedupeKey, notificationId });
    } catch (error) {
      await deps.releaseDedupe(dedupeKey);
      logMarketing({
        operation: "publication_failed_notify",
        contentId: publication.contentId,
        success: false,
        error: error instanceof Error ? error.message : "notify_failed",
      });
    }
  } catch (error) {
    logMarketing({
      operation: "publication_failed_notify",
      contentId: publication.contentId,
      success: false,
      error: error instanceof Error ? error.message : "notify_failed",
    });
  }
}
