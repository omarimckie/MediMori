import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BACKFILL_APPLY_CONFIRMATION,
  BACKFILL_MAX_ORDERS,
  ReleaseWindowBackfillError,
  applyBackfillConflicts,
  classifyReleaseWindowOrder,
  isRollbackEligible,
  notificationProvenance,
  planBackfillJobs,
  runReleaseWindowBackfill,
  type ReleaseWindowOrder,
} from "./backfill-release-window";
import type { OwnerPushJob } from "./process-owner-push";

const T0 = new Date("2026-10-17T15:00:00.000Z");
const T1 = new Date("2026-10-17T16:00:00.000Z");

function order(overrides: Partial<ReleaseWindowOrder> = {}): ReleaseWindowOrder {
  return {
    kind: "digital",
    orderId: "11111111-1111-4111-8111-111111111111",
    stripeCheckoutSessionId: "cs_live_window_order",
    occurredAt: new Date("2026-10-17T15:30:00.000Z"),
    quantity: 1,
    needsAttention: false,
    fulfillmentStatus: null,
    refundStatus: "paid",
    fullyRefundedAt: null,
    hasNotificationJob: false,
    ...overrides,
  };
}

test("release-window eligibility follows refunds and UTC bounds", () => {
  assert.equal(classifyReleaseWindowOrder(order(), T0, T1).eligible, true);
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ refundStatus: "partially_refunded" }), T0, T1),
    { eligible: true },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ refundStatus: "fully_refunded" }), T0, T1),
    { eligible: false, reason: "fully_refunded" },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(
      order({ refundStatus: "paid", fullyRefundedAt: new Date("2026-10-17T15:40:00.000Z") }),
      T0,
      T1,
    ),
    { eligible: false, reason: "fully_refunded" },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(
      order({
        kind: "physical",
        fulfillmentStatus: "refunded",
        refundStatus: null,
      }),
      T0,
      T1,
    ),
    { eligible: false, reason: "refunded_fulfillment" },
  );
  assert.equal(
    classifyReleaseWindowOrder(
      order({
        kind: "physical",
        fulfillmentStatus: "unfulfilled",
        refundStatus: null,
      }),
      T0,
      T1,
    ).eligible,
    true,
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ occurredAt: new Date("2026-10-17T14:59:59.000Z") }), T0, T1),
    { eligible: false, reason: "outside_window" },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ occurredAt: T0 }), T0, T1),
    { eligible: true },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ occurredAt: T1 }), T0, T1),
    { eligible: false, reason: "outside_window" },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ stripeCheckoutSessionId: "pi_not_a_session" }), T0, T1),
    { eligible: false, reason: "invalid_session" },
  );
  assert.deepEqual(
    classifyReleaseWindowOrder(order({ hasNotificationJob: true }), T0, T1),
    { eligible: false, reason: "existing_job" },
  );
});

test("backfill provenance is the run id and rollback stays unsent", () => {
  assert.equal(
    notificationProvenance({ backfillRunId: null, stripeEventId: null }),
    "unknown",
  );
  assert.equal(
    notificationProvenance({ backfillRunId: "run-1", stripeEventId: null }),
    "release_window_backfill",
  );
  const runId = "run-1";
  assert.equal(
    isRollbackEligible(
      {
        backfillRunId: runId,
        status: "queued",
        claimToken: null,
        sentAt: null,
        attemptCount: 0,
      },
      runId,
    ),
    true,
  );
  for (const status of ["sending", "sent", "failed", "exhausted"] as const) {
    assert.equal(
      isRollbackEligible(
        {
          backfillRunId: runId,
          status,
          claimToken: status === "sending" ? "token" : null,
          sentAt: status === "sent" ? T1 : null,
          attemptCount: 1,
        },
        runId,
      ),
      false,
    );
  }
  assert.equal(
    isRollbackEligible(
      {
        backfillRunId: "other-run",
        status: "queued",
        claimToken: null,
        sentAt: null,
        attemptCount: 0,
      },
      runId,
    ),
    false,
  );
});

test("backfill apply is dry-run by default, capped, and conflict-safe", async () => {
  const orders = [order()];
  const dry = await runReleaseWindowBackfill(
    {
      windowStart: T0.toISOString(),
      windowEnd: T1.toISOString(),
      operatorIdentity: "owner",
    },
    {
      listOrders: async () => orders,
      insertQueuedJobs: async () => {
        throw new Error("dry-run wrote a job");
      },
      claimQueued: async () => null,
      deliver: async () => ({ ok: true }),
      markSent: async () => true,
      markFailed: async () => true,
    },
  );
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.eligibleCount, 1);
  assert.equal(dry.insertedJobIds.length, 0);

  await assert.rejects(
    () =>
      runReleaseWindowBackfill(
        {
          windowStart: T0.toISOString(),
          windowEnd: T1.toISOString(),
          operatorIdentity: "owner",
          apply: true,
        },
        {
          listOrders: async () => orders,
          insertQueuedJobs: async () => {
            throw new Error("unconfirmed apply wrote a job");
          },
          claimQueued: async () => null,
          deliver: async () => ({ ok: true }),
          markSent: async () => true,
          markFailed: async () => true,
        },
      ),
    ReleaseWindowBackfillError,
  );

  const tooMany = Array.from({ length: BACKFILL_MAX_ORDERS + 1 }, (_, index) =>
    order({
      orderId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      stripeCheckoutSessionId: `cs_live_extra_${index}`,
    }),
  );
  await assert.rejects(
    () =>
      runReleaseWindowBackfill(
        {
          windowStart: T0.toISOString(),
          windowEnd: T1.toISOString(),
          operatorIdentity: "owner",
          apply: true,
          confirmation: BACKFILL_APPLY_CONFIRMATION,
        },
        {
          listOrders: async () => tooMany,
          insertQueuedJobs: async () => {
            throw new Error("oversized apply wrote a job");
          },
          claimQueued: async () => null,
          deliver: async () => ({ ok: true }),
          markSent: async () => true,
          markFailed: async () => true,
        },
      ),
    /limit is 25/,
  );

  const keys = new Set<string>(["owner-push:digital:cs_live_existing"]);
  const claims = new Map<string, string>();
  let inserts = 0;
  const applied = await runReleaseWindowBackfill(
    {
      windowStart: T0.toISOString(),
      windowEnd: T1.toISOString(),
      operatorIdentity: " release-operator ",
      apply: true,
      confirmation: BACKFILL_APPLY_CONFIRMATION,
    },
    {
      listOrders: async () => [
        order({ stripeCheckoutSessionId: "cs_live_existing", hasNotificationJob: false }),
        order({
          orderId: "22222222-2222-4222-8222-222222222222",
          stripeCheckoutSessionId: "cs_live_new",
        }),
      ],
      insertQueuedJobs: async (input) => {
        inserts += 1;
        assert.equal(input.operatorIdentity, "release-operator");
        assert.equal(input.windowStart.toISOString(), T0.toISOString());
        assert.equal(input.windowEnd.toISOString(), T1.toISOString());
        const conflict = applyBackfillConflicts(keys, input.jobs);
        assert.equal(conflict.skipped.length, 1);
        assert.equal(conflict.inserted.length, 1);
        for (const job of conflict.inserted) keys.add(job.dedupeKey);
        return { runId: "run-applied", insertedJobIds: conflict.inserted.map((job) => job.id) };
      },
      claimQueued: async (jobId) => {
        if (claims.has(jobId)) return null;
        const token = `token-${jobId}`;
        claims.set(jobId, token);
        const job: OwnerPushJob = {
          id: jobId,
          dedupeKey: "owner-push:digital:cs_live_new",
          orderKind: "digital",
          orderId: "22222222-2222-4222-8222-222222222222",
          stripeCheckoutSessionId: "cs_live_new",
          status: "sending",
          attemptCount: 1,
          maxAttempts: 8,
          title: "Ebook order received",
          body: "A paid ebook order (1 copy) was recorded.",
          destination: "/admin/orders/digital/22222222-2222-4222-8222-222222222222",
          lastError: null,
          claimToken: token,
        };
        return job;
      },
      deliver: async () => ({ ok: true }),
      markSent: async (jobId, claimToken) => claims.get(jobId) === claimToken,
      markFailed: async () => false,
    },
  );
  assert.equal(inserts, 1);
  assert.equal(applied.mode, "applied");
  assert.equal(applied.delivered, 1);
  assert.equal(applied.insertedJobIds.length, 1);

  const raced = planBackfillJobs([
    order({ stripeCheckoutSessionId: "cs_live_race" }),
    order({
      orderId: "33333333-3333-4333-8333-333333333333",
      stripeCheckoutSessionId: "cs_live_race",
    }),
  ]);
  const first = applyBackfillConflicts(new Set(), raced);
  const second = applyBackfillConflicts(
    new Set(first.inserted.map((job) => job.dedupeKey)),
    raced,
  );
  assert.equal(first.inserted.length, 1);
  assert.equal(second.inserted.length, 0);
  assert.equal(second.skipped.length, 2);
});

test("backfill SQL is notification-only and does not infer provenance from a null stripe event", () => {
  const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
  const backfill = readFileSync(new URL("./backfill-release-window.ts", import.meta.url), "utf8");
  assert.match(repository, /source,\s*window_start,\s*window_end,\s*operator_identity/);
  assert.match(repository, /'release_window_backfill'/);
  assert.match(repository, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.match(repository, /fulfillment_status IS DISTINCT FROM 'refunded'/);
  assert.match(repository, /refund_status IS DISTINCT FROM 'fully_refunded'/);
  assert.match(repository, /fully_refunded_at IS NULL/);
  assert.match(repository, /created_at >= /);
  assert.match(repository, /purchased_at >= /);
  assert.match(repository, /created_at < /);
  assert.match(repository, /purchased_at < /);
  assert.doesNotMatch(repository, /payment_status/);
  assert.doesNotMatch(repository, /stripe_event_id IS NULL/);
  assert.doesNotMatch(backfill, /stripe_event_id IS NULL/);
  assert.doesNotMatch(repository, /physical_inventory|INSERT INTO entitlements|UPDATE purchases|UPDATE physical_orders/);
  assert.doesNotMatch(backfill, /physical_inventory|INSERT INTO entitlements|sendPhysical|sendDigital|fulfillPhysicalOrder/);
  assert.match(
    repository,
    /DELETE FROM order_notification_jobs[\s\S]*status = 'queued'[\s\S]*claim_token IS NULL[\s\S]*sent_at IS NULL[\s\S]*attempt_count = 0/,
  );
  assert.doesNotMatch(repository, /LIMIT 25|LIMIT \$\{?25/);
});
