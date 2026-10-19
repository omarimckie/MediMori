import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { PhysicalOrderRow } from "../physical-orders";
import { handlePhysicalShipment, type ShippingConfirmationDeps } from "./shipping-confirmation";
import {
  buildShippingConfirmation,
  shippingFingerprint,
  type ShipmentDetails,
} from "./shipping-carriers";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function order(overrides: Partial<PhysicalOrderRow> = {}): PhysicalOrderRow {
  const now = new Date("2026-10-18T03:00:00.000Z");
  return {
    id: ORDER_ID,
    stripeCheckoutSessionId: "cs_test",
    stripePaymentIntentId: "pi_test",
    bookId: "book-one",
    quantity: 2,
    unitPriceCents: 1000,
    shippingPriceCents: 500,
    totalAmountCents: 2500,
    customerName: "Buyer <Name>",
    customerEmail: "buyer@example.com",
    shippingAddress: {
      name: "Buyer Name",
      line1: "123 Secret St",
      line2: null,
      city: "Miami",
      state: "FL",
      postalCode: "33101",
      country: "US",
    },
    shippingAddressMissing: false,
    paymentStatus: "paid",
    inventoryState: "applied",
    attentionFlags: [],
    fulfillmentStatus: "unfulfilled",
    trackingNumber: null,
    carrier: null,
    shippingNoticeStatus: null,
    shippingNoticeSentFingerprint: null,
    shippingNoticeError: null,
    shippingNoticeSentAt: null,
    purchasedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function memoryDeps(initial: PhysicalOrderRow, send: () => Promise<void>) {
  let current = initial;
  const deps: ShippingConfirmationDeps = {
    async getOrder(orderId) {
      return current.id === orderId ? current : null;
    },
    async saveInitial(orderId, shipment) {
      if (current.id !== orderId) return "missing";
      if (current.paymentStatus !== "paid") return "payment_ineligible";
      if (current.fulfillmentStatus !== "unfulfilled") return "not_awaiting";
      if (
        current.inventoryState === "processing" &&
        !current.attentionFlags.includes("inventory_discrepancy_acknowledged")
      ) {
        return "inventory_unresolved";
      }
      current = {
        ...current,
        fulfillmentStatus: "shipped",
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        shippingNoticeStatus: "pending",
        shippingNoticeError: null,
      };
      return "saved";
    },
    async saveCorrection(orderId, shipment) {
      if (current.id !== orderId) return "missing";
      if (current.paymentStatus !== "paid") return "payment_ineligible";
      if (current.fulfillmentStatus !== "shipped") return "not_shipped";
      if (current.shippingNoticeStatus === "sending") return "in_progress";
      const fingerprint = shippingFingerprint(shipment);
      const already = current.shippingNoticeSentFingerprint === fingerprint;
      current = {
        ...current,
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        shippingNoticeStatus: already ? "sent" : "pending",
        shippingNoticeError: null,
      };
      return already ? "already_sent" : "pending";
    },
    async claim(orderId, shipment) {
      if (current.id !== orderId) return "not_eligible";
      const fingerprint = shippingFingerprint(shipment);
      if (current.shippingNoticeSentFingerprint === fingerprint) return "already_sent";
      if (current.shippingNoticeStatus === "sending") return "in_progress";
      if (
        current.fulfillmentStatus !== "shipped" ||
        current.paymentStatus !== "paid" ||
        current.carrier !== shipment.carrier ||
        current.trackingNumber !== shipment.trackingNumber ||
        (current.shippingNoticeStatus !== "pending" && current.shippingNoticeStatus !== "failed")
      ) {
        return "not_eligible";
      }
      current = { ...current, shippingNoticeStatus: "sending" };
      return "claimed";
    },
    async markSent(orderId, shipment) {
      if (current.id !== orderId) return;
      current = {
        ...current,
        shippingNoticeStatus: "sent",
        shippingNoticeSentFingerprint: shippingFingerprint(shipment),
        shippingNoticeError: null,
        shippingNoticeSentAt: new Date(),
      };
    },
    async markFailed(orderId, code) {
      if (current.id !== orderId) return;
      current = {
        ...current,
        shippingNoticeStatus: "failed",
        shippingNoticeError: code,
      };
    },
    send,
  };
  return {
    deps,
    snapshot: () => current,
  };
}

const shipment: ShipmentDetails = { carrier: "usps", trackingNumber: "940011189000000000" };

test("shipping confirmation includes the order, carrier, tracking number, and carrier link", () => {
  const message = buildShippingConfirmation({
    to: "buyer@example.com",
    customerName: "Buyer <Name>",
    orderId: ORDER_ID,
    shipment,
  });
  assert.equal(message.to, "buyer@example.com");
  assert.match(message.text, new RegExp(ORDER_ID));
  assert.match(message.text, /USPS/);
  assert.match(message.text, /940011189000000000/);
  assert.match(message.text, /https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=940011189000000000/);
  assert.match(message.html, /Buyer &lt;Name&gt;/);
  assert.match(message.html, /href="https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=940011189000000000"/);
  assert.doesNotMatch(`${message.html}\n${message.text}`, /123 Secret St/);
  assert.equal(
    message.idempotencyKey,
    `physical-shipping:${ORDER_ID}:usps:940011189000000000`,
  );
});

test("a paid paperback ships once and a repeat does not send another customer email", async () => {
  let sends = 0;
  const store = memoryDeps(order(), async () => {
    sends += 1;
  });
  const first = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "ship",
    body: shipment,
    deps: store.deps,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.customerEmail, "delivered");
  assert.equal(store.snapshot().carrier, "usps");
  assert.equal(store.snapshot().trackingNumber, shipment.trackingNumber);
  assert.equal(store.snapshot().shippingNoticeStatus, "sent");

  const repeat = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "ship",
    body: shipment,
    deps: store.deps,
  });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.customerEmail, "already_delivered");
  assert.equal(sends, 1);
});

test("email failure keeps the saved shipment and a retry sends once", async () => {
  let fail = true;
  let sends = 0;
  const store = memoryDeps(order(), async () => {
    sends += 1;
    if (fail) throw Object.assign(new Error("send_failed"), { code: "send_failed" });
  });
  const failed = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "ship",
    body: shipment,
    deps: store.deps,
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.customerEmail, "failed");
  assert.equal(store.snapshot().fulfillmentStatus, "shipped");
  assert.equal(store.snapshot().trackingNumber, shipment.trackingNumber);
  assert.equal(store.snapshot().shippingNoticeStatus, "failed");

  fail = false;
  const retried = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "retry",
    body: null,
    deps: store.deps,
  });
  assert.equal(retried.body.customerEmail, "delivered");
  assert.equal(sends, 2);
  assert.equal(store.snapshot().shippingNoticeStatus, "sent");
});

test("unauthorized shipment requests do not read or change the order", async () => {
  const store = memoryDeps(order(), async () => {
    throw new Error("send should not be called");
  });
  const calling = new Proxy(store.deps, {
    get() {
      throw new Error("deps should not be called");
    },
  });
  const result = await handlePhysicalShipment({
    isAdmin: false,
    kind: "physical",
    orderId: ORDER_ID,
    action: "ship",
    body: shipment,
    deps: calling,
  });
  assert.equal(result.status, 401);
  assert.equal(store.snapshot().fulfillmentStatus, "unfulfilled");
  assert.equal(store.snapshot().trackingNumber, null);
});

test("unpaid, digital, and invalid shipment requests do not send email", async () => {
  let sends = 0;
  const store = memoryDeps(order({ paymentStatus: "unpaid" }), async () => {
    sends += 1;
  });
  const unpaid = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "ship",
    body: shipment,
    deps: store.deps,
  });
  assert.equal(unpaid.status, 409);
  assert.equal(store.snapshot().fulfillmentStatus, "unfulfilled");

  const digital = await handlePhysicalShipment({
    isAdmin: true,
    kind: "digital",
    orderId: ORDER_ID,
    action: "ship",
    body: shipment,
    deps: store.deps,
  });
  assert.equal(digital.status, 404);

  const invalid = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "ship",
    body: { carrier: "usps", trackingNumber: "<script>" },
    deps: store.deps,
  });
  assert.equal(invalid.status, 400);
  assert.equal(sends, 0);
});

test("correcting tracking sends one new email and repeating it does not", async () => {
  let sends = 0;
  const store = memoryDeps(
    order({
      fulfillmentStatus: "shipped",
      carrier: "usps",
      trackingNumber: shipment.trackingNumber,
      shippingNoticeStatus: "sent",
      shippingNoticeSentFingerprint: shippingFingerprint(shipment),
    }),
    async () => {
      sends += 1;
    },
  );
  const corrected = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "correct",
    body: { carrier: "ups", trackingNumber: "1Z999AA10123456784" },
    deps: store.deps,
  });
  assert.equal(corrected.body.customerEmail, "delivered");
  assert.equal(store.snapshot().carrier, "ups");
  assert.equal(sends, 1);

  const duplicate = await handlePhysicalShipment({
    isAdmin: true,
    kind: "physical",
    orderId: ORDER_ID,
    action: "correct",
    body: { carrier: "ups", trackingNumber: "1Z999AA10123456784" },
    deps: store.deps,
  });
  assert.equal(duplicate.body.customerEmail, "already_delivered");
  assert.equal(sends, 1);
});

test("shipment routes stay admin-only", () => {
  for (const file of ["ship/route.ts", "shipping-correction/route.ts", "shipping-notice/route.ts"]) {
    const source = readFileSync(
      new URL(`../../app/api/admin/orders/[kind]/[orderId]/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /isAdminAuthenticated/);
    assert.match(source, /handlePhysicalShipment/);
  }
});
