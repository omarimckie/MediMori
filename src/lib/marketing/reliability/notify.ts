import { sendMarketingAdminBroadcastNotification } from "../notifications/broadcast";
import type { MarketingNotificationPayload } from "../notifications/types";
import { formatPlatformLabel, formatScheduledForEt } from "./format";
import type { MarketingPublication } from "../types";

export function buildOverdueNotificationPayload(
  publication: MarketingPublication,
): MarketingNotificationPayload {
  const platform = formatPlatformLabel(publication.platform);
  const when = formatScheduledForEt(publication.scheduledFor);
  return {
    type: "publication_overdue",
    severity: "warning",
    title: `${platform} post is overdue`,
    body: `Scheduled for ${when} ET and still not published. Check Marketing Admin — automatic publishing may need attention.`,
    destination: "/admin/marketing/week",
    relatedContentId: publication.contentId,
    relatedPublicationId: publication.id,
  };
}

export function buildStuckProcessingNotificationPayload(
  publication: MarketingPublication,
): MarketingNotificationPayload {
  const platform = formatPlatformLabel(publication.platform);
  const attempts = publication.attemptCount;
  const errorHint = publication.lastError?.trim()
    ? ` Last error: ${publication.lastError.slice(0, 200)}`
    : "";
  return {
    type: "publication_ambiguous",
    severity: "error",
    title: `${platform} publish may be stuck`,
    body:
      `Publication has been processing for over 25 minutes (attempts: ${attempts}). ` +
      `Automatic reclaim may still run separately — investigate before retrying to avoid duplicates.${errorHint}`,
    destination: "/admin/marketing/week",
    relatedContentId: publication.contentId,
    relatedPublicationId: publication.id,
  };
}

export async function notifyReliabilityPayload(
  payload: MarketingNotificationPayload,
): Promise<{ notificationId: string; pushDelivered: number }> {
  const result = await sendMarketingAdminBroadcastNotification({
    ...payload,
    deliverPush: true,
  });
  return {
    notificationId: result.notification.id,
    pushDelivered: result.pushDelivered,
  };
}
