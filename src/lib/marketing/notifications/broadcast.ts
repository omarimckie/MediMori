import { normalizeMarketingNotificationDestination } from "./destination";
import {
  createAdminNotification,
  listAllEnabledPushSubscriptions,
  updateAdminNotificationDelivery,
} from "./notifications-repository";
import { sendWebPushToSubscription } from "./push-delivery";
import type {
  MarketingAdminNotificationRecord,
  MarketingNotificationPayload,
} from "./types";

export type SendMarketingAdminBroadcastInput = MarketingNotificationPayload & {
  deliverPush?: boolean;
};

export type SendMarketingAdminBroadcastResult = {
  notification: MarketingAdminNotificationRecord;
  pushAttempted: number;
  pushDelivered: number;
};

/**
 * One history row; Web Push to every enabled Marketing Admin subscription (all admins/devices).
 */
export async function sendMarketingAdminBroadcastNotification(
  input: SendMarketingAdminBroadcastInput,
): Promise<SendMarketingAdminBroadcastResult> {
  const destination = normalizeMarketingNotificationDestination(input.destination);
  const payload: MarketingNotificationPayload = {
    ...input,
    destination,
  };

  const notification = await createAdminNotification(payload, "pending");

  if (!input.deliverPush) {
    await updateAdminNotificationDelivery(notification.id, "skipped");
    return {
      notification: { ...notification, deliveryStatus: "skipped" },
      pushAttempted: 0,
      pushDelivered: 0,
    };
  }

  const subscriptions = await listAllEnabledPushSubscriptions();
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
