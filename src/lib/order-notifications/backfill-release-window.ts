import { buildOwnerLockScreenNotification, ownerPushDedupeKey, safePushErrorCode } from "./privacy";
import type { OrderKind } from "./privacy";
import type { OwnerPushJob } from "./process-owner-push";
import {
  claimQueuedOwnerPush,
  insertReleaseWindowBackfill,
  listReleaseWindowOrders,
  markOwnerPushFailed,
  markOwnerPushSent,
  rollbackReleaseWindowBackfill,
  type ReleaseWindowOrderRow,
} from "./repository";
import { deliverOwnerOrderPush } from "./owner-push-live";

export const BACKFILL_SOURCE = "release_window_backfill";
export const BACKFILL_APPLY_CONFIRMATION = "apply-release-window-backfill";
export const BACKFILL_MAX_ORDERS = 25;

export class ReleaseWindowBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseWindowBackfillError";
  }
}

export type ReleaseWindowOrder = ReleaseWindowOrderRow;

export type EligibilityReason =
  | "outside_window"
  | "invalid_session"
  | "existing_job"
  | "fully_refunded"
  | "refunded_fulfillment";

export type ReleaseWindowEligibility =
  | { eligible: true }
  | { eligible: false; reason: EligibilityReason };

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function parseUtcTimestamp(value: string): Date {
  if (!UTC_TIMESTAMP.test(value)) {
    throw new ReleaseWindowBackfillError("Release window bounds must be UTC timestamps.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReleaseWindowBackfillError("Release window bounds must be UTC timestamps.");
  }
  return parsed;
}

export function assertReleaseWindow(windowStart: Date, windowEnd: Date): void {
  if (
    Number.isNaN(windowStart.getTime()) ||
    Number.isNaN(windowEnd.getTime()) ||
    windowStart.getTime() >= windowEnd.getTime()
  ) {
    throw new ReleaseWindowBackfillError("Release window must be a non-empty half-open UTC interval.");
  }
}

export function isValidStripeCheckoutSessionId(value: string): boolean {
  const sessionId = value.trim();
  return /^cs_[A-Za-z0-9_]+$/.test(sessionId) && sessionId.length >= 8 && sessionId.length <= 255;
}

/**
 * Eligibility does not read payment_status. A physical paperback can stay eligible
 * after a later partial refund because that refund is not stored on physical_orders.
 * Only fulfillment_status = refunded removes a physical order.
 */
export function classifyReleaseWindowOrder(
  order: ReleaseWindowOrder,
  windowStart: Date,
  windowEnd: Date,
): ReleaseWindowEligibility {
  const occurredAt = order.occurredAt.getTime();
  if (occurredAt < windowStart.getTime() || occurredAt >= windowEnd.getTime()) {
    return { eligible: false, reason: "outside_window" };
  }
  if (!isValidStripeCheckoutSessionId(order.stripeCheckoutSessionId)) {
    return { eligible: false, reason: "invalid_session" };
  }
  if (order.hasNotificationJob) {
    return { eligible: false, reason: "existing_job" };
  }
  if (
    order.kind === "digital" &&
    (order.refundStatus === "fully_refunded" || order.fullyRefundedAt != null)
  ) {
    return { eligible: false, reason: "fully_refunded" };
  }
  if (order.kind === "physical" && order.fulfillmentStatus === "refunded") {
    return { eligible: false, reason: "refunded_fulfillment" };
  }
  return { eligible: true };
}

export function backfillDedupeKey(kind: OrderKind, stripeCheckoutSessionId: string): string {
  return ownerPushDedupeKey(kind, stripeCheckoutSessionId);
}

export function notificationProvenance(job: {
  backfillRunId: string | null;
  stripeEventId: string | null;
}): "release_window_backfill" | "stripe_event" | "unknown" {
  if (job.backfillRunId) return "release_window_backfill";
  if (job.stripeEventId) return "stripe_event";
  return "unknown";
}

export function isRollbackEligible(
  job: {
    backfillRunId: string | null;
    status: string;
    claimToken: string | null;
    sentAt: Date | null;
    attemptCount: number;
  },
  runId: string,
): boolean {
  return (
    job.backfillRunId === runId &&
    job.status === "queued" &&
    job.claimToken == null &&
    job.sentAt == null &&
    job.attemptCount === 0
  );
}

export type BackfillJobPlan = {
  id: string;
  dedupeKey: string;
  orderKind: OrderKind;
  orderId: string;
  stripeCheckoutSessionId: string;
  title: string;
  body: string;
  destination: string;
};

export function planBackfillJobs(
  orders: ReleaseWindowOrder[],
  createId: () => string = () => crypto.randomUUID(),
): BackfillJobPlan[] {
  return orders.map((order) => {
    const copy = buildOwnerLockScreenNotification({
      kind: order.kind,
      orderId: order.orderId,
      quantity: order.quantity,
      needsAttention: order.needsAttention,
    });
    return {
      id: createId(),
      dedupeKey: backfillDedupeKey(order.kind, order.stripeCheckoutSessionId),
      orderKind: order.kind,
      orderId: order.orderId,
      stripeCheckoutSessionId: order.stripeCheckoutSessionId.trim(),
      title: copy.title,
      body: copy.body,
      destination: copy.destination,
    };
  });
}

/** ON CONFLICT (dedupe_key) DO NOTHING. An existing key of any status is left unchanged. */
export function applyBackfillConflicts<T extends { dedupeKey: string }>(
  existingKeys: ReadonlySet<string>,
  planned: T[],
): { inserted: T[]; skipped: T[] } {
  const inserted: T[] = [];
  const skipped: T[] = [];
  const seen = new Set(existingKeys);
  for (const job of planned) {
    if (seen.has(job.dedupeKey)) {
      skipped.push(job);
      continue;
    }
    seen.add(job.dedupeKey);
    inserted.push(job);
  }
  return { inserted, skipped };
}

export type BackfillStore = {
  listOrders: (windowStart: Date, windowEnd: Date) => Promise<ReleaseWindowOrder[]>;
  insertQueuedJobs: (input: {
    operatorIdentity: string;
    windowStart: Date;
    windowEnd: Date;
    jobs: BackfillJobPlan[];
  }) => Promise<{ runId: string; insertedJobIds: string[] }>;
  claimQueued: (jobId: string) => Promise<OwnerPushJob | null>;
  deliver: (job: OwnerPushJob) => Promise<{ ok: boolean; error?: string }>;
  markSent: (jobId: string, claimToken: string) => Promise<boolean>;
  markFailed: (jobId: string, claimToken: string, error: string) => Promise<boolean>;
};

export type BackfillRunResult = {
  mode: "dry-run" | "applied";
  eligibleCount: number;
  runId: string | null;
  insertedJobIds: string[];
  delivered: number;
};

export async function runReleaseWindowBackfill(
  input: {
    windowStart: string;
    windowEnd: string;
    operatorIdentity: string;
    apply?: boolean;
    confirmation?: string;
  },
  store: BackfillStore,
): Promise<BackfillRunResult> {
  const windowStart = parseUtcTimestamp(input.windowStart);
  const windowEnd = parseUtcTimestamp(input.windowEnd);
  assertReleaseWindow(windowStart, windowEnd);
  const operatorIdentity = input.operatorIdentity.trim();
  if (!operatorIdentity) {
    throw new ReleaseWindowBackfillError("Operator identity is required.");
  }

  const orders = await store.listOrders(windowStart, windowEnd);
  const eligible = orders.filter(
    (order) => classifyReleaseWindowOrder(order, windowStart, windowEnd).eligible,
  );
  if (eligible.length > BACKFILL_MAX_ORDERS) {
    throw new ReleaseWindowBackfillError(
      `Refusing to backfill ${eligible.length} orders; the limit is ${BACKFILL_MAX_ORDERS}.`,
    );
  }
  if (input.apply !== true) {
    return {
      mode: "dry-run",
      eligibleCount: eligible.length,
      runId: null,
      insertedJobIds: [],
      delivered: 0,
    };
  }
  if (input.confirmation !== BACKFILL_APPLY_CONFIRMATION) {
    throw new ReleaseWindowBackfillError("Explicit confirmation is required to apply the backfill.");
  }
  if (eligible.length === 0) {
    return {
      mode: "applied",
      eligibleCount: 0,
      runId: null,
      insertedJobIds: [],
      delivered: 0,
    };
  }

  const inserted = await store.insertQueuedJobs({
    operatorIdentity,
    windowStart,
    windowEnd,
    jobs: planBackfillJobs(eligible),
  });
  let delivered = 0;
  for (const jobId of inserted.insertedJobIds) {
    const claimed = await store.claimQueued(jobId);
    if (!claimed?.claimToken) continue;
    const result = await store.deliver(claimed);
    if (result.ok) {
      if (await store.markSent(claimed.id, claimed.claimToken)) delivered += 1;
    } else {
      await store.markFailed(claimed.id, claimed.claimToken, safePushErrorCode(result.error));
    }
  }
  return {
    mode: "applied",
    eligibleCount: eligible.length,
    runId: inserted.runId,
    insertedJobIds: inserted.insertedJobIds,
    delivered,
  };
}

export async function runReleaseWindowBackfillLive(input: {
  windowStart: string;
  windowEnd: string;
  operatorIdentity: string;
  apply?: boolean;
  confirmation?: string;
}): Promise<BackfillRunResult> {
  return runReleaseWindowBackfill(input, {
    listOrders: listReleaseWindowOrders,
    insertQueuedJobs: insertReleaseWindowBackfill,
    claimQueued: claimQueuedOwnerPush,
    deliver: deliverOwnerOrderPush,
    markSent: markOwnerPushSent,
    markFailed: markOwnerPushFailed,
  });
}

export async function rollbackReleaseWindowBackfillLive(runId: string): Promise<string[]> {
  return rollbackReleaseWindowBackfill(runId);
}
