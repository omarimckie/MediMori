import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type Stripe from "stripe";
import { fulfillPhysicalOrder, type PhysicalFulfillmentDeps } from "../fulfill-physical-order";
import {
  PHYSICAL_SHIPPING_PRICE_CENTS,
  physicalOrderTotalCents,
} from "../physical-books";
import { evaluatePaidPhysicalCheckout } from "../physical-checkout-ownership";
import type { PhysicalOrderRow, ShippingAddressSnapshot } from "../physical-orders";
import type { VerifiedPhysicalCheckout } from "../physical-checkout-ownership";
import {
  itemizedDigitalLinesFromSession,
  keepFirstDigitalLines,
  persistItemizedDigitalPurchase,
} from "./digital-lines";
import {
  AWAITING_SHIPMENT_STATUS,
  acknowledgeOrderRecord,
  attentionMessages,
  fulfillmentAfterExplicitShip,
  listUnacknowledged,
  digitalPaymentLabel,
  physicalPaymentLabel,
  presentDigitalOrder,
  presentPhysicalOrder,
  UNEXPECTED_PAYMENT_STATUS_LABEL,
} from "./present-order";
import {
  OrderPersistenceError,
  ensureOwnerOrderPush,
  retryFailedOwnerOrderPushes,
  type OwnerPushDeps,
  type OwnerPushJob,
} from "./process-owner-push";
import {
  buildOwnerLockScreenNotification,
  isOwnerOrderNotificationDestination,
  safePushErrorCode,
} from "./privacy";
import { paidOrderWebhookHttpStatus } from "./webhook-ack";
import { parseOrderNotificationMigrationStatements } from "../../../scripts/apply-order-notifications-schema.mjs";
import {
  claimDueFailedJobs,
  markClaimedJobFailed,
  markClaimedJobSent,
  reclaimStaleSendingJobs,
  recoverExhaustedJob,
  type ClaimableNotificationJob,
} from "./claim-failed-jobs";
import {
  checkoutPaymentAcknowledgement,
  isPaidCheckoutFulfillmentEvent,
} from "./paid-session-events";
import {
  INVENTORY_DISCREPANCY_ACKNOWLEDGED,
  withInventoryDiscrepancyAcknowledged,
} from "./inventory-resolution";
import { evaluatePaidCheckout } from "../checkout-ownership";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_NAME = "Buyer Name";
const CUSTOMER_EMAIL = "buyer@example.com";
const STREET = "123 Secret Lane";
const CITY = "Miami";
const POSTAL = "33101";

const PRIVATE_ADDRESS: ShippingAddressSnapshot = {
  name: CUSTOMER_NAME,
  line1: STREET,
  line2: "Apt 9",
  city: CITY,
  state: "FL",
  postalCode: POSTAL,
  country: "US",
};

function assertNoCustomerSecrets(text: string) {
  for (const secret of [CUSTOMER_NAME, CUSTOMER_EMAIL, STREET, CITY, POSTAL, "Apt 9"]) {
    assert.equal(text.includes(secret), false, `lock-screen text leaked ${secret}`);
  }
}

function memoryPush(initialFail: boolean) {
  const jobs = new Map<string, OwnerPushJob>();
  const byKey = new Map<string, string>();
  const delivered: OwnerPushJob[] = [];
  let failPush = initialFail;
  let deliveries = 0;

  const deps: OwnerPushDeps = {
    async insertJob(input) {
      const existingId = byKey.get(input.dedupeKey);
      if (existingId) {
        const existing = jobs.get(existingId);
        if (!existing) throw new Error("missing job");
        return { created: false, job: existing };
      }
      const job: OwnerPushJob = {
        ...input,
        status: "queued",
        attemptCount: 0,
        maxAttempts: 8,
        lastError: null,
        claimToken: null,
      };
      jobs.set(job.id, job);
      byKey.set(input.dedupeKey, job.id);
      return { created: true, job };
    },
    async upsertAttention() {},
    async claimQueued(jobId) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "queued") return null;
      job.status = "sending";
      job.claimToken = crypto.randomUUID();
      job.attemptCount += 1;
      return { ...job };
    },
    async claimDueFailures(limit) {
      const due = [...jobs.values()].filter((job) => job.status === "failed").slice(0, limit);
      for (const job of due) {
        job.status = "sending";
        job.claimToken = crypto.randomUUID();
        job.attemptCount += 1;
      }
      return due.map((job) => ({ ...job }));
    },
    async markSent(jobId, claimToken) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "sending" || job.claimToken !== claimToken) return false;
      job.status = "sent";
      job.claimToken = null;
      job.lastError = null;
      return true;
    },
    async markFailed(jobId, claimToken, error) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "sending" || job.claimToken !== claimToken) return false;
      job.status = "failed";
      job.claimToken = null;
      job.lastError = safePushErrorCode(error);
      return true;
    },
    async deliver(job) {
      deliveries += 1;
      delivered.push(job);
      if (failPush) return { ok: false, error: "push_failed" };
      return { ok: true };
    },
  };

  return {
    deps,
    jobs,
    delivered,
    deliveryCount: () => deliveries,
    setFail(value: boolean) {
      failPush = value;
    },
  };
}

function verifiedOrder(
  overrides: Partial<VerifiedPhysicalCheckout> = {},
): VerifiedPhysicalCheckout {
  return {
    bookId: "book-one",
    quantity: 2,
    stripeCheckoutSessionId: "cs_test_order",
    stripePaymentIntentId: "pi_test_order",
    amountCents: physicalOrderTotalCents(2),
    currency: "usd",
    stripeChargeId: "ch_test_order",
    customerName: CUSTOMER_NAME,
    customerEmail: CUSTOMER_EMAIL,
    shippingAddress: PRIVATE_ADDRESS,
    shippingAddressMissing: false,
    unitPriceCents: 1000,
    shippingPriceCents: PHYSICAL_SHIPPING_PRICE_CENTS,
    ...overrides,
  };
}

function memoryFulfillment(decrement: () => Promise<number | null>) {
  const orders = new Map<string, PhysicalOrderRow>();
  let decrementCalls = 0;

  const deps: PhysicalFulfillmentDeps = {
    async insertPhysicalOrder(input) {
      const existing = [...orders.values()].find(
        (order) => order.stripeCheckoutSessionId === input.stripeCheckoutSessionId,
      );
      if (existing) return { created: false, order: existing };
      const now = new Date();
      const order: PhysicalOrderRow = {
        id: crypto.randomUUID(),
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        bookId: input.bookId,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        shippingPriceCents: input.shippingPriceCents,
        totalAmountCents: input.totalAmountCents,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        shippingAddress: input.shippingAddress,
        shippingAddressMissing: input.shippingAddressMissing === true,
        paymentStatus: "paid",
        inventoryState: "pending",
        attentionFlags: [...(input.attentionFlags ?? [])],
        fulfillmentStatus: input.fulfillmentStatus,
        trackingNumber: null,
        carrier: null,
        shippingNoticeStatus: null,
        shippingNoticeSentFingerprint: null,
        shippingNoticeError: null,
        shippingNoticeSentAt: null,
        purchasedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      orders.set(order.id, order);
      return { created: true, order };
    },
    async claimPhysicalInventoryProcessing(sessionId) {
      const order = [...orders.values()].find(
        (row) => row.stripeCheckoutSessionId === sessionId,
      );
      if (!order || order.inventoryState !== "pending") return "settled";
      order.inventoryState = "processing";
      return "claimed";
    },
    async decrementPhysicalInventory() {
      decrementCalls += 1;
      return decrement();
    },
    async markPhysicalInventoryApplied(orderId) {
      const order = orders.get(orderId);
      if (order) order.inventoryState = "applied";
    },
    async markPhysicalInventoryFailed(orderId) {
      const order = orders.get(orderId);
      if (!order) return;
      order.inventoryState = "failed";
      order.paymentStatus = "paid";
      order.fulfillmentStatus = "unfulfilled";
      if (!order.attentionFlags.includes("inventory_processing_failed")) {
        order.attentionFlags.push("inventory_processing_failed");
      }
    },
    async getPhysicalOrderByCheckoutSessionId(sessionId) {
      return (
        [...orders.values()].find((order) => order.stripeCheckoutSessionId === sessionId) ??
        null
      );
    },
  };

  return {
    deps,
    orders,
    decrementCalls: () => decrementCalls,
  };
}

const pushInput = {
  kind: "physical" as const,
  orderId: ORDER_ID,
  quantity: 2,
  needsAttention: true,
  stripeCheckoutSessionId: "cs_test_notify",
  stripeEventId: "evt_1",
  attentionFlags: ["missing_shipping_address"],
  customerName: CUSTOMER_NAME,
  customerEmail: CUSTOMER_EMAIL,
  shippingAddress: PRIVATE_ADDRESS,
};

test("webhook acknowledgement retries persistence and not push delivery", () => {
  assert.equal(
    paidOrderWebhookHttpStatus({
      orderPersisted: true,
      notificationJobPersisted: true,
    }),
    200,
  );
  assert.equal(
    paidOrderWebhookHttpStatus({
      orderPersisted: false,
      notificationJobPersisted: false,
    }),
    500,
  );
  assert.equal(
    paidOrderWebhookHttpStatus({
      orderPersisted: true,
      notificationJobPersisted: false,
    }),
    500,
  );
});

test("duplicate Stripe events reuse one notification job and do not push twice", async () => {
  const push = memoryPush(false);
  const first = await ensureOwnerOrderPush(pushInput, push.deps);
  const second = await ensureOwnerOrderPush(
    { ...pushInput, stripeEventId: "evt_2" },
    push.deps,
  );

  assert.equal(first.pushDelivered, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.pushDelivered, true);
  assert.equal(push.jobs.size, 1);
  assert.equal(push.deliveryCount(), 1);
  assert.equal(push.delivered[0]?.title, "Paperback order received");
  assert.match(push.delivered[0]?.body ?? "", /awaiting shipment/);
  assertNoCustomerSecrets(`${push.delivered[0]?.title} ${push.delivered[0]?.body} ${push.delivered[0]?.destination}`);
  assert.equal(isOwnerOrderNotificationDestination(push.delivered[0]?.destination ?? ""), true);
});

test("push failure stays retriable without another webhook delivery", async () => {
  const push = memoryPush(true);
  const first = await ensureOwnerOrderPush(pushInput, push.deps);
  assert.equal(first.jobPersisted, true);
  assert.equal(first.pushDelivered, false);
  assert.equal(
    paidOrderWebhookHttpStatus({
      orderPersisted: true,
      notificationJobPersisted: first.jobPersisted,
    }),
    200,
  );

  const replay = await ensureOwnerOrderPush(
    { ...pushInput, stripeEventId: "evt_retry" },
    push.deps,
  );
  assert.equal(replay.duplicate, true);
  assert.equal(push.deliveryCount(), 1);

  push.setFail(false);
  const retried = await retryFailedOwnerOrderPushes(push.deps);
  assert.equal(retried.attempted, 1);
  assert.equal(retried.delivered, 1);
  assert.equal(push.deliveryCount(), 2);
  assert.equal([...push.jobs.values()][0]?.status, "sent");
  assertNoCustomerSecrets(push.delivered.map((job) => `${job.title} ${job.body}`).join(" "));
});

test("notification persistence failure is raised for a webhook retry", async () => {
  const push = memoryPush(false);
  push.deps.insertJob = async () => {
    throw new Error("database unavailable");
  };
  await assert.rejects(
    () => ensureOwnerOrderPush(pushInput, push.deps),
    OrderPersistenceError,
  );
  assert.equal(push.deliveryCount(), 0);
});

test("lock-screen copy distinguishes paperback and ebook orders without customer data", () => {
  const physical = buildOwnerLockScreenNotification({
    ...pushInput,
    kind: "physical",
  });
  const digital = buildOwnerLockScreenNotification({
    ...pushInput,
    kind: "digital",
    needsAttention: false,
  });

  assert.equal(physical.title, "Paperback order received");
  assert.match(physical.body, /paperback/i);
  assert.equal(digital.title, "Ebook order received");
  assert.match(digital.body, /ebook/i);
  assert.notEqual(physical.title, digital.title);
  for (const note of [physical, digital]) {
    assertNoCustomerSecrets(`${note.title}\n${note.body}\n${note.destination}`);
  }
  assert.equal(safePushErrorCode(`${CUSTOMER_EMAIL} ${STREET}`), "push_failed");
});

test("inventory processing failure keeps the paid order awaiting shipment", async () => {
  for (const decrement of [
    async () => null as number | null,
    async () => {
      throw new Error("inventory database failed");
    },
  ]) {
    const store = memoryFulfillment(decrement);
    const result = await fulfillPhysicalOrder({} as Stripe, verifiedOrder(), store.deps);
    assert.equal(result.order.paymentStatus, "paid");
    assert.equal(result.order.fulfillmentStatus, AWAITING_SHIPMENT_STATUS);
    assert.equal(result.order.inventoryState, "failed");
    assert.equal(result.inventoryProcessingFailed, true);
    assert.ok(result.order.attentionFlags.includes("inventory_processing_failed"));
    assert.equal(fulfillmentAfterExplicitShip(result.order.fulfillmentStatus), "shipped");

    const replay = await fulfillPhysicalOrder({} as Stripe, verifiedOrder(), store.deps);
    assert.equal(replay.duplicate, true);
    assert.equal(store.decrementCalls(), 1);
    assert.equal(store.orders.size, 1);
  }
});

test("a successful paid physical order is not marked shipped automatically", async () => {
  const store = memoryFulfillment(async () => 18);
  const result = await fulfillPhysicalOrder({} as Stripe, verifiedOrder(), store.deps);
  assert.equal(result.order.inventoryState, "applied");
  assert.equal(result.order.fulfillmentStatus, "unfulfilled");
  assert.equal(result.order.paymentStatus, "paid");
  assert.equal(fulfillmentAfterExplicitShip("shipped"), null);
  assert.equal(fulfillmentAfterExplicitShip("unfulfilled"), "shipped");
});

test("physical order insert failure is not acknowledged", async () => {
  const store = memoryFulfillment(async () => 1);
  store.deps.insertPhysicalOrder = async () => {
    throw new Error("insert failed");
  };
  await assert.rejects(
    () => fulfillPhysicalOrder({} as Stripe, verifiedOrder(), store.deps),
    /insert failed/,
  );
  assert.equal(store.decrementCalls(), 0);
});

test("missing shipping address is stored as a visible exception and stays off the lock screen", () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousPrice = process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE;
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = "price_test_physical_book_one";
  try {
  const quantity = 1;
  const session = {
    id: "cs_test_missing_address",
    object: "checkout.session",
    payment_status: "paid",
    amount_total: physicalOrderTotalCents(quantity),
    currency: "usd",
    metadata: {
      purchaseType: "physical",
      bookId: "book-one",
      quantity: String(quantity),
      customerName: CUSTOMER_NAME,
    },
    customer_details: {
      email: CUSTOMER_EMAIL,
      name: CUSTOMER_NAME,
    },
    line_items: {
      object: "list",
      data: [
        {
          id: "li_missing_address",
          object: "item",
          quantity,
          price: { id: "price_test_physical_book_one", object: "price" },
        },
      ],
      has_more: false,
      url: "",
    },
    total_details: { amount_shipping: PHYSICAL_SHIPPING_PRICE_CENTS },
    payment_intent: "pi_missing_address",
  } as unknown as Stripe.Checkout.Session;

  const evaluation = evaluatePaidPhysicalCheckout(session);
  assert.equal(evaluation.ok, true);
  if (!evaluation.ok) return;
  assert.equal(evaluation.order.shippingAddressMissing, true);

  const detail = presentPhysicalOrder({
    orderId: ORDER_ID,
    customerName: CUSTOMER_NAME,
    customerEmail: CUSTOMER_EMAIL,
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    items: [{ title: "Children Diseases: Sickle Cell", quantity: 1, unitAmountCents: 1000 }],
    shippingAddress: evaluation.order.shippingAddress,
    shippingAddressMissing: true,
    attentionFlags: ["missing_shipping_address"],
    inventoryState: "applied",
    acknowledgedAt: null,
    justAcknowledged: false,
  });
  assert.match(detail.shippingException ?? "", /Shipping address was not provided/);
  assert.ok(detail.attention.some((message) => /shipping address/i.test(message)));
  assert.ok(detail.shippingFields?.every((field) => field.value == null));
  assert.equal(detail.paymentStatus, "Paid");
  assert.equal(detail.fulfillmentStatus, "Awaiting shipment");

  const note = buildOwnerLockScreenNotification({
    kind: "physical",
    orderId: ORDER_ID,
    quantity: 1,
    needsAttention: true,
    customerName: CUSTOMER_NAME,
    customerEmail: CUSTOMER_EMAIL,
    shippingAddress: evaluation.order.shippingAddress,
  });
  assertNoCustomerSecrets(`${note.title} ${note.body} ${note.destination}`);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousPrice === undefined) delete process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE;
    else process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = previousPrice;
  }
});

test("order detail shows the full address, items, quantities, payment, and fulfillment", () => {
  const detail = presentPhysicalOrder({
    orderId: ORDER_ID,
    customerName: CUSTOMER_NAME,
    customerEmail: CUSTOMER_EMAIL,
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    items: [{ title: "Children Diseases: Sickle Cell", quantity: 2, unitAmountCents: 1000 }],
    shippingAddress: PRIVATE_ADDRESS,
    shippingAddressMissing: false,
    attentionFlags: [],
    inventoryState: "applied",
    acknowledgedAt: null,
    justAcknowledged: true,
  });

  assert.equal(detail.customerName, CUSTOMER_NAME);
  assert.equal(detail.customerEmail, CUSTOMER_EMAIL);
  assert.equal(detail.items[0]?.quantity, 2);
  assert.equal(detail.paymentStatus, "Paid");
  assert.equal(detail.fulfillmentStatus, "Awaiting shipment");
  assert.equal(detail.trackingNumber, null);
  assert.equal(detail.shippingException, null);
  const values = new Map(detail.shippingFields?.map((field) => [field.label, field.value]));
  assert.equal(values.get("Name"), CUSTOMER_NAME);
  assert.equal(values.get("Address line 1"), STREET);
  assert.equal(values.get("Address line 2"), "Apt 9");
  assert.equal(values.get("City"), CITY);
  assert.equal(values.get("State"), "FL");
  assert.equal(values.get("Postal code"), POSTAL);
  assert.equal(values.get("Country"), "US");
  assert.match(detail.acknowledgementLabel, /Marked reviewed/);

  const tracked = presentPhysicalOrder({
    orderId: ORDER_ID,
    customerName: CUSTOMER_NAME,
    customerEmail: CUSTOMER_EMAIL,
    paymentStatus: "paid",
    fulfillmentStatus: "shipped",
    items: [{ title: "Children Diseases: Sickle Cell", quantity: 2, unitAmountCents: 1000 }],
    shippingAddress: PRIVATE_ADDRESS,
    shippingAddressMissing: false,
    attentionFlags: [],
    inventoryState: "applied",
    acknowledgedAt: null,
    justAcknowledged: true,
    trackingNumber: "1Z999AA10123456784",
    carrier: "ups",
    shippingNoticeStatus: "sent",
    shippingNoticeError: null,
  });
  assert.equal(tracked.trackingNumber, "1Z999AA10123456784");
  assert.equal(tracked.carrierLabel, "UPS");
  assert.equal(tracked.canMarkShipped, false);
  assert.equal(tracked.canCorrectShipment, true);
  assert.equal(tracked.shippingNoticeLabel, "Customer shipping email delivered.");
});

test("unknown payment statuses are not labeled paid", () => {
  assert.equal(physicalPaymentLabel("paid"), "Paid");
  assert.equal(physicalPaymentLabel("refunded"), "Refunded");
  assert.equal(physicalPaymentLabel("partially_refunded"), "Partially refunded");
  for (const status of ["unpaid", "failed", "pending", "no_payment_required", ""]) {
    assert.equal(physicalPaymentLabel(status), UNEXPECTED_PAYMENT_STATUS_LABEL);
    assert.notEqual(physicalPaymentLabel(status), "Paid");
  }
  assert.equal(digitalPaymentLabel("paid"), "Paid");
  assert.equal(
    digitalPaymentLabel("unpaid" as Parameters<typeof digitalPaymentLabel>[0]),
    UNEXPECTED_PAYMENT_STATUS_LABEL,
  );
});

test("tracking number rejects unsafe values", async () => {
  const { parseShipment } = await import("./shipping-carriers");
  assert.equal(parseShipment({ carrier: "usps", trackingNumber: "   " }).ok, false);
  const spaced = parseShipment({
    carrier: "usps",
    trackingNumber: " 9400 1118 9000 0000 00 ",
  });
  assert.equal(spaced.ok, true);
  if (spaced.ok) assert.equal(spaced.shipment.trackingNumber, "940011189000000000");
  assert.equal(parseShipment({ carrier: "usps", trackingNumber: "1Z<script>" }).ok, false);
  assert.equal(parseShipment({ carrier: "usps", trackingNumber: "A".repeat(65) }).ok, false);
  assert.equal(parseShipment({ carrier: "pirate-ship", trackingNumber: "123" }).ok, false);
});

test("digital purchases keep itemized quantities and stay deduplicated", async () => {
  const session = {
    line_items: {
      data: [
        {
          quantity: 2,
          amount_subtotal: 1400,
          price: {
            id: "price_1TMhTEGmFetwj9NcJnvrh1e2",
            object: "price",
            unit_amount: 700,
          },
        },
        {
          quantity: 1,
          amount_subtotal: 700,
          price: {
            id: "price_1TMhTEGmFetwj9NcJnvrh1e2",
            object: "price",
            unit_amount: 700,
          },
        },
      ],
    },
  } as Stripe.Checkout.Session;

  const lines = itemizedDigitalLinesFromSession(session, "book-one");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.quantity, 3);
  assert.equal(lines[0]?.bookId, "book-one");
  assert.equal(lines[0]?.unitAmountCents, 700);

  const stored: typeof lines = [];
  await persistItemizedDigitalPurchase(lines, async (incoming) => {
    stored.splice(0, stored.length, ...keepFirstDigitalLines(stored, incoming));
  });
  await persistItemizedDigitalPurchase(lines, async (incoming) => {
    stored.splice(0, stored.length, ...keepFirstDigitalLines(stored, incoming));
  });
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.quantity, 3);

  await assert.rejects(
    () => persistItemizedDigitalPurchase([], async () => {}),
    /no itemized lines/,
  );

  const detail = presentDigitalOrder({
    orderId: ORDER_ID,
    customerEmail: CUSTOMER_EMAIL,
    refundStatus: "paid",
    items: lines.map((line) => ({
      title: line.title,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
    })),
    acknowledgedAt: null,
    justAcknowledged: false,
  });
  assert.equal(detail.paymentStatus, "Paid");
  assert.equal(detail.fulfillmentStatus, "Access granted");
  assert.equal(detail.items[0]?.quantity, 3);
  assert.equal(detail.canMarkShipped, false);
});

test("unacknowledged order tracking survives a later review", () => {
  const rows = [
    { id: ORDER_ID, acknowledgedAt: null as Date | null },
    { id: "22222222-2222-4222-8222-222222222222", acknowledgedAt: null as Date | null },
  ];
  assert.equal(listUnacknowledged(rows).length, 2);

  const openedAt = new Date("2026-10-16T16:00:00.000Z");
  const firstOpen = acknowledgeOrderRecord(rows[0]!, openedAt);
  rows[0]!.acknowledgedAt = firstOpen.acknowledgedAt;
  assert.equal(firstOpen.wasUnacknowledged, true);

  const secondOpen = acknowledgeOrderRecord(rows[0]!, new Date("2026-10-17T16:00:00.000Z"));
  assert.equal(secondOpen.wasUnacknowledged, false);
  assert.equal(secondOpen.acknowledgedAt.toISOString(), openedAt.toISOString());
  assert.deepEqual(
    listUnacknowledged(rows).map((row) => row.id),
    ["22222222-2222-4222-8222-222222222222"],
  );
  assert.ok(attentionMessages(["inventory_processing_failed"])[0]?.includes("kept"));
});

test("order notification migration parses the durable tables before indexes", () => {
  const sql = readFileSync(
    new URL("../../../sql/order-notifications.sql", import.meta.url),
    "utf8",
  );
  const statements = parseOrderNotificationMigrationStatements(sql);
  assert.equal(statements.length, 14);
  assert.match(statements[4], /digital_purchase_items/);
  assert.match(statements[5], /order_notification_jobs/);
  assert.match(statements[7], /order_attention/);
  assert.match(statements[9], /claim_token/);
  assert.match(statements[10], /order_notification_backfill_runs/);
  assert.match(statements[11], /backfill_run_id/);
  assert.match(statements[12], /max_attempts/);
  assert.match(statements[13], /order_notification_job_recoveries/);
});

test("tapping an order notification opens an authenticated admin order page", () => {
  const worker = readFileSync(
    new URL("../../../public/marketing-sw.js", import.meta.url),
    "utf8",
  );
  assert.match(worker, /function isOrderDestination/);
  assert.match(worker, /physical\|digital/);
  assert.match(worker, /openWindow\(destination\)/);
  assert.match(worker, /\/admin\/marketing/);
  const destination = buildOwnerLockScreenNotification(pushInput).destination;
  assert.equal(destination, `/admin/orders/physical/${ORDER_ID}`);
  assert.match(worker, /isOrderDestination\(path\)/);
});

test("physical fulfillment no longer refunds a paid order when inventory fails", () => {
  const source = readFileSync(
    new URL("../fulfill-physical-order.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /refundStripePaymentIntent/);
  assert.match(source, /markPhysicalInventoryFailed/);
  const webhook = readFileSync(
    new URL("../../app/api/webhooks/stripe/route.ts", import.meta.url),
    "utf8",
  );
  const fulfillAt = webhook.indexOf("await fulfillPhysicalOrder");
  const notifyAt = webhook.indexOf("await ensureOwnerOrderPushLive");
  const recordAt = webhook.lastIndexOf("recordPurchaseAndEntitlement");
  assert.ok(fulfillAt > 0 && notifyAt > fulfillAt);
  assert.ok(recordAt > 0 && webhook.indexOf("persistItemizedDigitalPurchase", recordAt) > recordAt);
});

function failedNotificationJob(
  id: string,
  overrides: Partial<ClaimableNotificationJob> = {},
): ClaimableNotificationJob {
  return {
    id,
    status: "failed",
    claimToken: null,
    nextAttemptAt: 0,
    createdAt: 1,
    attemptCount: 1,
    maxAttempts: 8,
    lastError: null,
    ...overrides,
  };
}

test("concurrent retry workers cannot claim or finish the same failed notification", () => {
  const raced = failedNotificationJob("job-raced");
  const seenFailed = [raced.status, raced.status];
  let unsafeClaims = 0;
  for (const statusAtSelect of seenFailed) {
    if (statusAtSelect === "failed") {
      raced.status = "sending";
      unsafeClaims += 1;
    }
  }
  assert.equal(unsafeClaims, 2);

  const job = failedNotificationJob("job-safe");
  const now = 10;
  const locks = new Set<string>();
  const first = claimDueFailedJobs({
    jobs: [job],
    now,
    limit: 20,
    lockedIds: locks,
    createToken: () => "token-a",
  });
  assert.equal(first.length, 1);
  assert.equal(first[0]?.claimToken, "token-a");
  locks.add(job.id);

  const overlapped = claimDueFailedJobs({
    jobs: [job],
    now,
    limit: 20,
    lockedIds: locks,
    createToken: () => "token-b",
  });
  assert.equal(overlapped.length, 0);
  locks.delete(job.id);

  const afterCommit = claimDueFailedJobs({
    jobs: [job],
    now,
    limit: 20,
    lockedIds: locks,
    createToken: () => "token-c",
  });
  assert.equal(afterCommit.length, 0);
  assert.equal(markClaimedJobSent(job, "token-a"), true);

  const pollAfterSent = claimDueFailedJobs({
    jobs: [job],
    now,
    limit: 20,
    lockedIds: locks,
    createToken: () => "token-d",
  });
  assert.equal(pollAfterSent.length, 0);
  assert.equal(job.status, "sent");

  const stale = failedNotificationJob("job-stale");
  const updatedAt = new Map<string, number>([[stale.id, 1]]);
  const claimed = claimDueFailedJobs({
    jobs: [stale],
    now,
    limit: 20,
    lockedIds: new Set(),
    createToken: () => "token-old",
  });
  assert.equal(claimed.length, 1);
  updatedAt.set(stale.id, 1);
  assert.equal(reclaimStaleSendingJobs([stale], updatedAt, 120), 1);
  assert.equal(stale.status, "failed");
  assert.equal(stale.claimToken, null);

  const recovered = claimDueFailedJobs({
    jobs: [stale],
    now,
    limit: 20,
    lockedIds: new Set(),
    createToken: () => "token-new",
  });
  assert.equal(recovered.length, 1);
  assert.equal(markClaimedJobSent(stale, "token-old"), false);
  assert.equal(stale.status, "sending");
  assert.equal(stale.claimToken, "token-new");
  assert.equal(markClaimedJobSent(stale, "token-new"), true);

  const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /AND jobs\.status = 'failed'/);
  assert.match(repository, /claim_token = gen_random_uuid\(\)/);
  assert.match(repository, /claim_token = \$\{claimToken\}::uuid/);
  assert.match(repository, /INTERVAL '2 minutes'/);
  assert.match(repository, /claim_token = NULL/);
  assert.match(repository, /attempt_count < max_attempts/);
  assert.match(repository, /jobs\.attempt_count < jobs\.max_attempts/);
  assert.doesNotMatch(repository, /last_error = 'delivery_interrupted'/);
  assert.match(repository, /WHEN attempt_count >= max_attempts THEN 'exhausted'/);
});

test("delayed Checkout events acknowledge pending completion and fulfill only when paid", async () => {
  assert.deepEqual(checkoutPaymentAcknowledgement("checkout.session.completed", "unpaid"), {
    fulfill: false,
    httpStatus: 200,
  });
  assert.deepEqual(
    checkoutPaymentAcknowledgement("checkout.session.completed", "no_payment_required"),
    { fulfill: false, httpStatus: 200 },
  );
  assert.deepEqual(checkoutPaymentAcknowledgement("checkout.session.completed", "paid"), {
    fulfill: true,
  });
  assert.deepEqual(
    checkoutPaymentAcknowledgement("checkout.session.async_payment_succeeded", "unpaid"),
    { fulfill: false, httpStatus: 402 },
  );
  assert.deepEqual(
    checkoutPaymentAcknowledgement("checkout.session.async_payment_succeeded", "paid"),
    { fulfill: true },
  );
  assert.equal(isPaidCheckoutFulfillmentEvent("checkout.session.async_payment_failed"), false);

  const unpaid = {
    id: "cs_delayed_unpaid",
    payment_status: "unpaid",
  } as Stripe.Checkout.Session;
  const physicalPending = evaluatePaidPhysicalCheckout(unpaid);
  const digitalPending = evaluatePaidCheckout(unpaid);
  assert.equal(physicalPending.ok, false);
  assert.equal(digitalPending.ok, false);

  const webhook = readFileSync(
    new URL("../../app/api/webhooks/stripe/route.ts", import.meta.url),
    "utf8",
  );
  const signatureAt = webhook.indexOf("Invalid Stripe signature.");
  const gateAt = webhook.indexOf("isPaidCheckoutFulfillmentEvent(event.type)");
  const pendingAt = webhook.indexOf("const acknowledgement = checkoutPaymentAcknowledgement(");
  const fulfillAt = webhook.indexOf("await fulfillPhysicalOrder");
  const recordAt = webhook.lastIndexOf("recordPurchaseAndEntitlement");
  assert.ok(signatureAt > 0 && signatureAt < gateAt);
  assert.match(webhook.slice(signatureAt, signatureAt + 180), /status: 400/);
  assert.ok(gateAt > 0 && pendingAt > gateAt);
  assert.ok(fulfillAt > pendingAt && recordAt > pendingAt);
  assert.match(webhook, /paidOrderWebhookHttpStatus/);
  assert.equal(
    paidOrderWebhookHttpStatus({
      orderPersisted: false,
      notificationJobPersisted: false,
    }),
    500,
  );
  assert.doesNotMatch(webhook, /event\.type !== "checkout\.session\.completed"/);

  const sessionId = "cs_delayed_once";
  const store = memoryFulfillment(async () => 9);
  const push = memoryPush(false);
  const verified = verifiedOrder({ stripeCheckoutSessionId: sessionId });
  const pendingCompletion = checkoutPaymentAcknowledgement(
    "checkout.session.completed",
    "unpaid",
  );
  assert.equal(pendingCompletion.fulfill, false);
  assert.equal(store.decrementCalls(), 0);
  assert.equal(store.orders.size, 0);
  assert.equal(push.deliveryCount(), 0);

  const asyncPaid = checkoutPaymentAcknowledgement(
    "checkout.session.async_payment_succeeded",
    "paid",
  );
  assert.equal(asyncPaid.fulfill, true);
  const created = await fulfillPhysicalOrder({} as Stripe, verified, store.deps);
  const firstPush = await ensureOwnerOrderPush(
    { ...pushInput, stripeCheckoutSessionId: sessionId, stripeEventId: "evt_async_paid" },
    push.deps,
  );
  assert.equal(created.duplicate, false);
  assert.equal(created.order.paymentStatus, "paid");
  assert.equal(store.decrementCalls(), 1);
  assert.equal(store.orders.size, 1);
  assert.equal(firstPush.pushDelivered, true);
  assert.equal(push.jobs.size, 1);

  const completedAfter = checkoutPaymentAcknowledgement("checkout.session.completed", "paid");
  assert.equal(completedAfter.fulfill, true);
  const replay = await fulfillPhysicalOrder({} as Stripe, verified, store.deps);
  const replayPush = await ensureOwnerOrderPush(
    { ...pushInput, stripeCheckoutSessionId: sessionId, stripeEventId: "evt_completed_replay" },
    push.deps,
  );
  assert.equal(replay.duplicate, true);
  assert.equal(store.decrementCalls(), 1);
  assert.equal(store.orders.size, 1);
  assert.equal(replayPush.duplicate, true);
  assert.equal(push.deliveryCount(), 1);
  assert.equal(push.jobs.size, 1);

  const purchases = readFileSync(new URL("../purchases.ts", import.meta.url), "utf8");
  const digitalItems = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
  assert.match(purchases, /ON CONFLICT \(stripe_checkout_session_id\) DO NOTHING/);
  assert.match(digitalItems, /ON CONFLICT \(purchase_id, book_id\) DO NOTHING/);
  assert.match(digitalItems, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
});

test("completed and async payment events cannot fulfill the same physical order twice", async () => {
  const store = memoryFulfillment(async () => 9);
  const verified = verifiedOrder({ stripeCheckoutSessionId: "cs_delayed_paid" });
  const asyncSuccess = await fulfillPhysicalOrder({} as Stripe, verified, store.deps);
  const completedLater = await fulfillPhysicalOrder({} as Stripe, verified, store.deps);
  assert.equal(asyncSuccess.duplicate, false);
  assert.equal(completedLater.duplicate, true);
  assert.equal(store.decrementCalls(), 1);
  assert.equal(store.orders.size, 1);
  assert.equal(completedLater.order.inventoryState, "applied");
});

test("uncertain inventory blocks shipment until acknowledged and is not decremented again", async () => {
  const store = memoryFulfillment(async () => 4);
  const created = await fulfillPhysicalOrder({} as Stripe, verifiedOrder(), store.deps);
  const order = created.order;
  order.inventoryState = "processing";

  const replay = await fulfillPhysicalOrder({} as Stripe, verifiedOrder(), store.deps);
  assert.equal(replay.duplicate, true);
  assert.equal(store.decrementCalls(), 1);
  assert.equal(replay.order.inventoryState, "processing");
  assert.equal(replay.order.paymentStatus, "paid");
  assert.equal(replay.order.fulfillmentStatus, "unfulfilled");

  const detailInput = {
    orderId: order.id,
    customerName: CUSTOMER_NAME,
    customerEmail: CUSTOMER_EMAIL,
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled" as const,
    items: [{ title: "Children Diseases: Sickle Cell", quantity: 2, unitAmountCents: 1000 }],
    shippingAddress: PRIVATE_ADDRESS,
    shippingAddressMissing: false,
    attentionFlags: order.attentionFlags,
    inventoryState: "processing" as const,
    acknowledgedAt: new Date("2026-10-16T16:00:00.000Z"),
    justAcknowledged: true,
  };
  const uncertain = presentPhysicalOrder(detailInput);
  assert.equal(uncertain.canMarkShipped, false);
  assert.equal(uncertain.inventoryDiscrepancyOpen, true);
  assert.ok(uncertain.attention.some((message) => /will not be decremented again/i.test(message)));
  assert.equal(uncertain.customerName, CUSTOMER_NAME);
  assert.equal(uncertain.shippingFields?.find((field) => field.label === "Address line 1")?.value, STREET);

  const acknowledgedFlags = withInventoryDiscrepancyAcknowledged(order.attentionFlags);
  assert.ok(acknowledgedFlags.includes(INVENTORY_DISCREPANCY_ACKNOWLEDGED));
  assert.equal(order.inventoryState, "processing");
  const acknowledged = presentPhysicalOrder({
    ...detailInput,
    attentionFlags: acknowledgedFlags,
    justAcknowledged: false,
  });
  assert.equal(acknowledged.inventoryDiscrepancyOpen, false);
  assert.equal(acknowledged.canMarkShipped, true);
  assert.ok(
    acknowledged.attention.some((message) => /Stock was not changed/i.test(message)),
  );

  const applied = presentPhysicalOrder({
    ...detailInput,
    inventoryState: "applied",
    attentionFlags: [],
  });
  assert.equal(applied.canMarkShipped, true);
  assert.equal(applied.inventoryDiscrepancyOpen, false);

  const knownFailure = presentPhysicalOrder({
    ...detailInput,
    inventoryState: "failed",
    attentionFlags: ["inventory_processing_failed"],
  });
  assert.equal(knownFailure.canMarkShipped, true);
  assert.equal(knownFailure.inventoryDiscrepancyOpen, false);

  const shipRoute = readFileSync(
    new URL("../../app/api/admin/orders/[kind]/[orderId]/ship/route.ts", import.meta.url),
    "utf8",
  );
  const orders = readFileSync(new URL("../physical-orders.ts", import.meta.url), "utf8");
  const resolution = readFileSync(new URL("./inventory-resolution.ts", import.meta.url), "utf8");
  assert.match(orders, /inventory_state <> 'processing'/);
  assert.match(orders, /INVENTORY_DISCREPANCY_ACKNOWLEDGED/);
  assert.match(orders, /inventory_state = 'processing'/);
  assert.match(resolution, /inventory_discrepancy_acknowledged/);
  assert.doesNotMatch(orders, /decrementPhysicalInventory/);
  const handler = readFileSync(new URL("./shipping-confirmation.ts", import.meta.url), "utf8");
  assert.match(handler, /inventory_unresolved/);
  assert.match(handler, /!input\.isAdmin/);
  assert.match(shipRoute, /isAdminAuthenticated/);
  assert.match(shipRoute, /handlePhysicalShipment/);
  assert.match(orders, /payment_status = 'paid'/);
  assert.match(orders, /tracking_number = \$\{shipment\.trackingNumber\}/);
  assert.match(orders, /carrier = \$\{shipment\.carrier\}/);
  assert.match(orders, /shipping_notice_status = 'failed'/);
  assert.match(orders, /shipping_notice_error = \$\{code\}/);
  assert.match(orders, /fulfillment_status = 'unfulfilled'/);
});

test("eight automatic claims exhaust a notification and the ninth requires recovery", () => {
  const job = failedNotificationJob("job-cap", { attemptCount: 7, lastError: "push_failed" });
  const claimed = claimDueFailedJobs({
    jobs: [job],
    now: 10,
    limit: 20,
    lockedIds: new Set(),
    createToken: () => "token-8",
  });
  assert.equal(claimed.length, 1);
  assert.equal(job.attemptCount, 8);
  assert.equal(markClaimedJobFailed(job, "token-8", "push_failed"), true);
  assert.equal(job.status, "exhausted");
  assert.equal(job.lastError, "push_failed");
  assert.equal(
    claimDueFailedJobs({
      jobs: [job],
      now: 10,
      limit: 20,
      lockedIds: new Set(),
      createToken: () => "token-9",
    }).length,
    0,
  );

  const audits: Parameters<typeof recoverExhaustedJob>[0]["audits"] = [];
  const missed = recoverExhaustedJob({
    job: failedNotificationJob("job-open", { status: "failed" }),
    adminUsername: "owner",
    reason: "not exhausted",
    now: "2026-10-17T18:00:00.000Z",
    audits,
  });
  assert.equal(missed, false);
  assert.equal(audits.length, 0);

  assert.equal(
    recoverExhaustedJob({
      job,
      adminUsername: "owner",
      reason: "manual notification recovery",
      now: "2026-10-17T18:00:00.000Z",
      audits,
    }),
    true,
  );
  assert.equal(
    recoverExhaustedJob({
      job,
      adminUsername: "other-admin",
      reason: "second click",
      now: "2026-10-17T18:00:01.000Z",
      audits,
    }),
    false,
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.priorStatus, "exhausted");
  assert.equal(audits[0]?.priorAttemptCount, 8);
  assert.equal(audits[0]?.priorLastError, "push_failed");
  assert.equal(audits[0]?.adminUsername, "owner");
  assert.equal(job.attemptCount, 8);
  assert.equal(job.maxAttempts, 9);
  assert.equal(job.status, "failed");

  const ninth = claimDueFailedJobs({
    jobs: [job],
    now: 11,
    limit: 20,
    lockedIds: new Set(),
    createToken: () => "token-ninth",
  });
  assert.equal(ninth.length, 1);
  assert.equal(job.attemptCount, 9);
  assert.equal(markClaimedJobFailed(job, "token-ninth", "push_failed"), true);
  assert.equal(job.status, "exhausted");
  assert.equal(
    claimDueFailedJobs({
      jobs: [job],
      now: 12,
      limit: 20,
      lockedIds: new Set(),
      createToken: () => "token-tenth",
    }).length,
    0,
  );

  const successful = failedNotificationJob("job-ninth-ok", {
    status: "exhausted",
    attemptCount: 8,
    lastError: "no_owner_subscriptions",
  });
  const successAudits: typeof audits = [];
  assert.equal(
    recoverExhaustedJob({
      job: successful,
      adminUsername: "owner",
      reason: "subscriptions restored",
      now: "2026-10-17T18:05:00.000Z",
      audits: successAudits,
    }),
    true,
  );
  const successClaim = claimDueFailedJobs({
    jobs: [successful],
    now: 13,
    limit: 20,
    lockedIds: new Set(),
    createToken: () => "token-sent",
  });
  assert.equal(successClaim.length, 1);
  assert.equal(markClaimedJobSent(successful, "token-sent"), true);
  assert.equal(successful.status, "sent");
  assert.equal(successful.attemptCount, 9);
});

test("stale sending at the attempt cap is exhausted without another increment", () => {
  const job = failedNotificationJob("job-stale-cap", {
    status: "sending",
    claimToken: "token-stale",
    attemptCount: 8,
    lastError: "push_failed",
  });
  const updatedAt = new Map<string, number>([[job.id, 1]]);
  assert.equal(reclaimStaleSendingJobs([job], updatedAt, 120), 1);
  assert.equal(job.status, "exhausted");
  assert.equal(job.attemptCount, 8);
  assert.equal(job.lastError, "push_failed");
  assert.equal(job.claimToken, null);
  assert.equal(
    claimDueFailedJobs({
      jobs: [job],
      now: 200,
      limit: 20,
      lockedIds: new Set(),
      createToken: () => "token-after-stale",
    }).length,
    0,
  );
});

test("notification recovery is an admin session route and does not mutate fulfillment", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/orders/[kind]/[orderId]/notification-recovery/route.ts", import.meta.url),
    "utf8",
  );
  const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
  assert.match(route, /isAdminAuthenticated/);
  assert.match(route, /getAuthenticatedAdminUsername/);
  assert.doesNotMatch(route, /CRON_SECRET|cronAuthDecision/);
  assert.doesNotMatch(route, /fulfillPhysicalOrder|recordPurchaseAndEntitlement|sendPhysical|sendDigital/);
  assert.match(repository, /WITH recovered AS/);
  assert.match(repository, /INSERT INTO order_notification_job_recoveries/);
  assert.match(repository, /FROM recovered/);
  assert.match(repository, /max_attempts = max_attempts \+ 1/);
  assert.doesNotMatch(repository, /UPDATE physical_orders|UPDATE purchases|physical_inventory|INSERT INTO entitlements/);
});
