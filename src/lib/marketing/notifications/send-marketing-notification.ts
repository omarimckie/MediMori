import { normalizeMarketingNotificationDestination } from "./destination";
import {
  createAdminNotification,
  listEnabledPushSubscriptionsForAdmin,
  updateAdminNotificationDelivery,
} from "./notifications-repository";
import { sendWebPushToSubscription } from "./push-delivery";
import type {
  MarketingAdminNotificationRecord,
  MarketingNotificationPayload,
} from "./types";

export type SendMarketingNotificationInput = MarketingNotificationPayload & {
  /** When set, push is delivered only to this admin's enabled subscriptions. */
  adminUsername?: string | null;
  /** When false, only persist history (no Web Push). */
  deliverPush?: boolean;
};

export type SendMarketingNotificationResult = {
  notification: MarketingAdminNotificationRecord;
  pushAttempted: number;
  pushDelivered: number;
};

export async function sendMarketingNotification(
  input: SendMarketingNotificationInput,
): Promise<SendMarketingNotificationResult> {
  const destination = normalizeMarketingNotificationDestination(input.destination);
  const payload: MarketingNotificationPayload = {
    ...input,
    destination,
  };

  const notification = await createAdminNotification(payload, "pending");

  if (!input.deliverPush || !input.adminUsername) {
    await updateAdminNotificationDelivery(notification.id, "skipped");
    return {
      notification: { ...notification, deliveryStatus: "skipped" },
      pushAttempted: 0,
      pushDelivered: 0,
    };
  }

  const subscriptions = await listEnabledPushSubscriptionsForAdmin(input.adminUsername);
  if (!subscriptions.length) {
    await updateAdminNotificationDelivery(notification.id, "skipped");
    return {
      notification: { ...notification, deliveryStatus: "skipped" },
      pushAttempted: 0,
      pushDelivered: 0,
    };
  }

  let delivered = 0;
  for (const sub of subscriptions) {
    const result = await sendWebPushToSubscription(sub, {
      title: payload.title,
      body: payload.body,
      destination: payload.destination,
      notificationId: notification.id,
    });
    if (result.ok) delivered += 1;
  }

  const deliveryStatus =
    delivered === 0
      ? "failed"
      : delivered < subscriptions.length
        ? "partial"
        : "delivered";
  await updateAdminNotificationDelivery(notification.id, deliveryStatus);

  return {
    notification: { ...notification, deliveryStatus },
    pushAttempted: subscriptions.length,
    pushDelivered: delivered,
  };
}

export async function sendTestMarketingNotification(
  adminUsername: string,
): Promise<SendMarketingNotificationResult> {
  return sendMarketingNotification({
    type: "test",
    severity: "info",
    title: "Twilight Feather Marketing",
    body: "Phone notifications are working.",
    destination: "/admin/marketing",
    adminUsername,
    deliverPush: true,
  });
}
