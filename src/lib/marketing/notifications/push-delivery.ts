import webpush from "web-push";
import {
  configureWebPushVapid,
  getWebPushVapidConfig,
} from "./vapid";
import type { MarketingPushSubscriptionRecord } from "./types";
import {
  recordPushSubscriptionFailure,
  recordPushSubscriptionSuccess,
} from "./notifications-repository";

export type PushPayload = {
  title: string;
  body: string;
  destination: string;
  notificationId?: string;
};

function isPermanentWebPushError(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

export async function sendWebPushToSubscription(
  subscription: MarketingPushSubscriptionRecord,
  payload: PushPayload,
): Promise<{ ok: boolean; permanentFailure: boolean }> {
  const vapid = getWebPushVapidConfig();
  if (!vapid) {
    return { ok: false, permanentFailure: false };
  }
  configureWebPushVapid(vapid);

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(
      pushSubscription,
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    await recordPushSubscriptionSuccess(subscription.id);
    return { ok: true, permanentFailure: false };
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode: number }).statusCode)
        : 0;
    const permanent = isPermanentWebPushError(statusCode);
    await recordPushSubscriptionFailure(subscription.id, permanent);
    return { ok: false, permanentFailure: permanent };
  }
}
