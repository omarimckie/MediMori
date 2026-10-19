import type { OrderKind } from "./privacy";
import {
  buildOwnerLockScreenNotification,
  ownerPushDedupeKey,
  safePushErrorCode,
  type OwnerLockScreenInput,
} from "./privacy";

export class OrderPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderPersistenceError";
  }
}

export type OwnerPushJobStatus = "queued" | "sending" | "sent" | "failed" | "exhausted";

export type OwnerPushJob = {
  id: string;
  dedupeKey: string;
  orderKind: OrderKind;
  orderId: string;
  stripeCheckoutSessionId: string;
  status: OwnerPushJobStatus;
  attemptCount: number;
  maxAttempts: number;
  title: string;
  body: string;
  destination: string;
  lastError: string | null;
  claimToken: string | null;
};

export type OwnerPushDeps = {
  insertJob: (input: {
    id: string;
    dedupeKey: string;
    orderKind: OrderKind;
    orderId: string;
    stripeEventId: string | null;
    stripeCheckoutSessionId: string;
    title: string;
    body: string;
    destination: string;
  }) => Promise<{ created: boolean; job: OwnerPushJob }>;
  upsertAttention: (input: {
    orderKind: OrderKind;
    orderId: string;
    attentionFlags: string[];
  }) => Promise<void>;
  claimQueued: (jobId: string) => Promise<OwnerPushJob | null>;
  claimDueFailures: (limit: number) => Promise<OwnerPushJob[]>;
  markSent: (jobId: string, claimToken: string) => Promise<boolean>;
  markFailed: (jobId: string, claimToken: string, error: string) => Promise<boolean>;
  deliver: (job: OwnerPushJob) => Promise<{ ok: boolean; error?: string }>;
};

export type EnsureOwnerPushResult = {
  jobPersisted: boolean;
  pushDelivered: boolean;
  duplicate: boolean;
};

async function deliverClaimed(
  job: OwnerPushJob,
  deps: OwnerPushDeps,
): Promise<boolean> {
  if (!job.claimToken) return false;
  const claimToken = job.claimToken;
  try {
    const result = await deps.deliver(job);
    if (result.ok) {
      return deps.markSent(job.id, claimToken);
    }
    await deps.markFailed(job.id, claimToken, safePushErrorCode(result.error));
    return false;
  } catch {
    try {
      await deps.markFailed(job.id, claimToken, "push_failed");
    } catch (error) {
      throw new OrderPersistenceError(
        error instanceof Error ? error.message : "notification job was not updated",
      );
    }
    return false;
  }
}

export async function ensureOwnerOrderPush(
  input: OwnerLockScreenInput & {
    stripeCheckoutSessionId: string;
    stripeEventId: string | null;
    attentionFlags: string[];
  },
  deps: OwnerPushDeps,
): Promise<EnsureOwnerPushResult> {
  const copy = buildOwnerLockScreenNotification(input);
  let stored: { created: boolean; job: OwnerPushJob };
  try {
    await deps.upsertAttention({
      orderKind: input.kind,
      orderId: input.orderId,
      attentionFlags: input.attentionFlags,
    });
    stored = await deps.insertJob({
      id: crypto.randomUUID(),
      dedupeKey: ownerPushDedupeKey(input.kind, input.stripeCheckoutSessionId),
      orderKind: input.kind,
      orderId: input.orderId,
      stripeEventId: input.stripeEventId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      title: copy.title,
      body: copy.body,
      destination: copy.destination,
    });
  } catch (error) {
    if (error instanceof OrderPersistenceError) throw error;
    throw new OrderPersistenceError(
      error instanceof Error ? error.message : "notification job was not recorded",
    );
  }

  if (stored.job.status !== "queued") {
    return {
      jobPersisted: true,
      pushDelivered: stored.job.status === "sent",
      duplicate: true,
    };
  }

  let claimed: OwnerPushJob | null;
  try {
    claimed = await deps.claimQueued(stored.job.id);
  } catch (error) {
    throw new OrderPersistenceError(
      error instanceof Error ? error.message : "notification job was not claimed",
    );
  }
  if (!claimed) {
    return { jobPersisted: true, pushDelivered: false, duplicate: true };
  }

  const pushDelivered = await deliverClaimed(claimed, deps);
  return {
    jobPersisted: true,
    pushDelivered,
    duplicate: !stored.created,
  };
}

export async function retryFailedOwnerOrderPushes(
  deps: OwnerPushDeps,
  limit = 20,
): Promise<{ attempted: number; delivered: number }> {
  const claimed = await deps.claimDueFailures(limit);
  let delivered = 0;
  for (const job of claimed) {
    if (await deliverClaimed(job, deps)) delivered += 1;
  }
  return { attempted: claimed.length, delivered };
}
