import { listAllEnabledPushSubscriptions } from "@/lib/marketing/notifications/notifications-repository";
import { sendWebPushToSubscription } from "@/lib/marketing/notifications/push-delivery";
import {
  claimDueFailedOwnerPushJobs,
  claimQueuedOwnerPush,
  claimSpecificFailedOwnerPush,
  insertOwnerPushJob,
  markOwnerPushFailed,
  markOwnerPushSent,
  reclaimStaleSendingOwnerPushJobs,
  upsertOrderAttention,
} from "./repository";
import {
  ensureOwnerOrderPush,
  retryFailedOwnerOrderPushes,
  type OwnerPushDeps,
} from "./process-owner-push";
import { isOwnerOrderNotificationDestination, type OwnerLockScreenInput } from "./privacy";
import type { OwnerPushJob } from "./process-owner-push";

function liveDeps(): OwnerPushDeps {
  return {
    insertJob: insertOwnerPushJob,
    upsertAttention: upsertOrderAttention,
    claimQueued: claimQueuedOwnerPush,
    claimDueFailures: claimDueFailedOwnerPushJobs,
    markSent: markOwnerPushSent,
    markFailed: markOwnerPushFailed,
    deliver: deliverOwnerOrderPush,
  };
}

export async function deliverOwnerOrderPush(
  job: Pick<OwnerPushJob, "id" | "title" | "body" | "destination">,
): Promise<{ ok: boolean; error?: string }> {
  if (!isOwnerOrderNotificationDestination(job.destination)) {
    return { ok: false, error: "push_failed" };
  }

  const subscriptions = await listAllEnabledPushSubscriptions();
  if (!subscriptions.length) {
    return { ok: false, error: "no_owner_subscriptions" };
  }

  let delivered = 0;
  for (const subscription of subscriptions) {
    const result = await sendWebPushToSubscription(subscription, {
      title: job.title,
      body: job.body,
      destination: job.destination,
      notificationId: job.id,
    });
    if (result.ok) delivered += 1;
  }

  if (delivered === 0) return { ok: false, error: "push_failed" };
  return { ok: true };
}

export async function ensureOwnerOrderPushLive(
  input: OwnerLockScreenInput & {
    stripeCheckoutSessionId: string;
    stripeEventId: string | null;
    attentionFlags: string[];
  },
) {
  return ensureOwnerOrderPush(input, liveDeps());
}

export async function retryFailedOwnerOrderPushesLive(limit = 20) {
  await reclaimStaleSendingOwnerPushJobs();
  return retryFailedOwnerOrderPushes(liveDeps(), limit);
}

/** One claim of an already authorized failed job. Does not insert a new job. */
export async function deliverOneFailedOwnerPush(
  jobId: string,
): Promise<"sent" | "exhausted" | "failed" | "not_claimed"> {
  const claimed = await claimSpecificFailedOwnerPush(jobId);
  if (!claimed?.claimToken) return "not_claimed";
  const result = await deliverOwnerOrderPush(claimed);
  if (result.ok) {
    const sent = await markOwnerPushSent(claimed.id, claimed.claimToken);
    return sent ? "sent" : "not_claimed";
  }
  await markOwnerPushFailed(claimed.id, claimed.claimToken, result.error ?? "push_failed");
  return claimed.attemptCount >= claimed.maxAttempts ? "exhausted" : "failed";
}
