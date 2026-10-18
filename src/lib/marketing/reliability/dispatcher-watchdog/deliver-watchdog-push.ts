import { normalizeMarketingNotificationDestination } from "../../notifications/destination";
import {
  createAdminNotification,
  listEnabledPushSubscriptionsForAdmin,
  updateAdminNotificationDelivery,
} from "../../notifications/notifications-repository";
import { sendWebPushToSubscription } from "../../notifications/push-delivery";
import type { SendMarketingNotificationResult } from "../../notifications/send-marketing-notification";
import type { MarketingNotificationPayload } from "../../notifications/types";
import type { WatchdogRepository } from "./repository";

export type WatchdogPushPayload = MarketingNotificationPayload & {
  adminUsername: string;
};

export type ClassifiedPushOutcome = {
  pushDelivered: number;
  ambiguous: boolean;
};

export function classifyWatchdogPushDelivery(
  result: Pick<SendMarketingNotificationResult, "pushAttempted" | "pushDelivered"> & {
    deliveryStatus?: string;
  },
): ClassifiedPushOutcome {
  const { pushAttempted, pushDelivered } = result;
  if (pushAttempted === 0) {
    return { pushDelivered: 0, ambiguous: false };
  }
  if (pushDelivered === 0) {
    return { pushDelivered: 0, ambiguous: false };
  }
  if (pushDelivered < pushAttempted) {
    return { pushDelivered, ambiguous: true };
  }
  if (result.deliveryStatus === "partial") {
    return { pushDelivered, ambiguous: true };
  }
  return { pushDelivered, ambiguous: false };
}

export type DeliverPushForAdminInput = WatchdogPushPayload & {
  notificationId: string;
};

export type DeliverPushForAdminDeps = {
  listSubscriptions: typeof listEnabledPushSubscriptionsForAdmin;
  sendToSubscription: typeof sendWebPushToSubscription;
  updateDelivery: typeof updateAdminNotificationDelivery;
};

const defaultDeliverPushDeps: DeliverPushForAdminDeps = {
  listSubscriptions: listEnabledPushSubscriptionsForAdmin,
  sendToSubscription: sendWebPushToSubscription,
  updateDelivery: updateAdminNotificationDelivery,
};

/** Delivers web push for an existing admin notification row (no new DB row). */
export async function deliverPushForExistingAdminNotification(
  input: DeliverPushForAdminInput,
  deps: DeliverPushForAdminDeps = defaultDeliverPushDeps,
): Promise<SendMarketingNotificationResult> {
  const subscriptions = await deps.listSubscriptions(input.adminUsername);
  if (!subscriptions.length) {
    await deps.updateDelivery(input.notificationId, "skipped");
    return {
      notification: {
        id: input.notificationId,
        deliveryStatus: "skipped",
      } as SendMarketingNotificationResult["notification"],
      pushAttempted: 0,
      pushDelivered: 0,
    };
  }

  let delivered = 0;
  for (const sub of subscriptions) {
    const result = await deps.sendToSubscription(sub, {
      title: input.title,
      body: input.body,
      destination: input.destination,
      notificationId: input.notificationId,
    });
    if (result.ok) {
      delivered += 1;
    }
  }

  const deliveryStatus =
    delivered === 0
      ? "failed"
      : delivered < subscriptions.length
        ? "partial"
        : "delivered";
  await deps.updateDelivery(input.notificationId, deliveryStatus);

  return {
    notification: {
      id: input.notificationId,
      deliveryStatus,
    } as SendMarketingNotificationResult["notification"],
    pushAttempted: subscriptions.length,
    pushDelivered: delivered,
  };
}

export type DeliverWatchdogOutagePushResult =
  | { status: "not_attempted"; reason: string }
  | { status: "acquire_blocked" | "acquire_missing" }
  | { status: "begin_rejected"; code: string }
  | { status: "finalized"; pushDelivered: number; ambiguous: boolean };

export type DeliverWatchdogRecoveryPushResult =
  | { status: "not_attempted"; reason: string }
  | { status: "acquire_blocked" | "acquire_missing" }
  | { status: "begin_rejected"; code: string }
  | { status: "finalized"; pushDelivered: number; ambiguous: boolean };

export type DeliverWatchdogPushDeps = DeliverPushForAdminDeps & {
  createNotification: typeof createAdminNotification;
};

const defaultDeliverWatchdogPushDeps: DeliverWatchdogPushDeps = {
  ...defaultDeliverPushDeps,
  createNotification: createAdminNotification,
};

export async function deliverWatchdogOutagePush(
  repo: WatchdogRepository,
  input: {
    incidentId: string;
    now: Date;
    payload: WatchdogPushPayload;
  },
  deps: DeliverWatchdogPushDeps = defaultDeliverWatchdogPushDeps,
): Promise<DeliverWatchdogOutagePushResult> {
  const claim = await repo.tryAcquireOutagePushClaim(input.incidentId);
  if (claim.status === "blocked") {
    return { status: "acquire_blocked" };
  }
  if (claim.status === "missing") {
    return { status: "acquire_missing" };
  }

  const destination = normalizeMarketingNotificationDestination(input.payload.destination);
  const notification = await deps.createNotification(
    {
      type: input.payload.type,
      severity: input.payload.severity,
      title: input.payload.title,
      body: input.payload.body,
      destination,
      relatedIncidentId: input.incidentId,
      metadata: input.payload.metadata,
    },
    "pending",
  );

  const begun = await repo.beginOutagePushAttempt({
    incidentId: input.incidentId,
    claimNonce: claim.claimNonce,
    adminNotificationId: notification.id,
    now: input.now,
  });
  if (!begun.ok) {
    return { status: "begin_rejected", code: begun.code };
  }

  const pushResult = await deliverPushForExistingAdminNotification(
    {
      ...input.payload,
      destination,
      notificationId: notification.id,
    },
    deps,
  );
  const classified = classifyWatchdogPushDelivery({
    pushAttempted: pushResult.pushAttempted,
    pushDelivered: pushResult.pushDelivered,
    deliveryStatus: pushResult.notification.deliveryStatus,
  });

  await repo.recordOutagePushOutcome({
    incidentId: input.incidentId,
    claimNonce: claim.claimNonce,
    pushDelivered: classified.pushDelivered,
    ambiguous: classified.ambiguous,
    now: input.now,
  });

  return {
    status: "finalized",
    pushDelivered: classified.pushDelivered,
    ambiguous: classified.ambiguous,
  };
}

export async function deliverWatchdogRecoveryPush(
  repo: WatchdogRepository,
  input: {
    incidentId: string;
    now: Date;
    payload: WatchdogPushPayload;
  },
  deps: DeliverWatchdogPushDeps = defaultDeliverWatchdogPushDeps,
): Promise<DeliverWatchdogRecoveryPushResult> {
  const claim = await repo.tryAcquireRecoveryPushClaim(input.incidentId);
  if (claim.status === "blocked") {
    return { status: "acquire_blocked" };
  }
  if (claim.status === "missing") {
    return { status: "acquire_missing" };
  }

  const destination = normalizeMarketingNotificationDestination(input.payload.destination);
  const notification = await deps.createNotification(
    {
      type: input.payload.type,
      severity: input.payload.severity,
      title: input.payload.title,
      body: input.payload.body,
      destination,
      relatedIncidentId: input.incidentId,
      metadata: input.payload.metadata,
    },
    "pending",
  );

  const begun = await repo.beginRecoveryPushAttempt({
    incidentId: input.incidentId,
    claimNonce: claim.claimNonce,
    adminNotificationId: notification.id,
    now: input.now,
  });
  if (!begun.ok) {
    return { status: "begin_rejected", code: begun.code };
  }

  const pushResult = await deliverPushForExistingAdminNotification(
    {
      ...input.payload,
      destination,
      notificationId: notification.id,
    },
    deps,
  );
  const classified = classifyWatchdogPushDelivery({
    pushAttempted: pushResult.pushAttempted,
    pushDelivered: pushResult.pushDelivered,
    deliveryStatus: pushResult.notification.deliveryStatus,
  });

  await repo.finalizeRecoveryPushClaim({
    incidentId: input.incidentId,
    claimNonce: claim.claimNonce,
    pushDelivered: classified.pushDelivered,
    ambiguous: classified.ambiguous,
    now: input.now,
  });

  return {
    status: "finalized",
    pushDelivered: classified.pushDelivered,
    ambiguous: classified.ambiguous,
  };
}
