import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  filterAdminOrderList,
  normalizeDigitalAmountCents,
  normalizePhysicalFulfillmentStatus,
  parseAdminOrderListFilters,
  sortAdminOrderList,
  type AdminOrderListRow,
} from "./admin-orders-list";
import { physicalFulfillmentLabel } from "./present-order";

function sampleRow(
  overrides: Partial<AdminOrderListRow> & Pick<AdminOrderListRow, "kind" | "orderId">,
): AdminOrderListRow {
  const base: AdminOrderListRow = {
    kind: overrides.kind,
    orderId: overrides.orderId,
    orderedAt: "2026-10-18T12:00:00.000Z",
    bookId: "book-three",
    productTitle: "Children Diseases: Asthma",
    quantity: 1,
    totalAmountCents: 1499,
    paymentStatusRaw: "paid",
    paymentStatusLabel: "Paid",
    fulfillmentStatusRaw: overrides.kind === "physical" ? "unfulfilled" : null,
    fulfillmentStatusLabel:
      overrides.kind === "physical" ? "Awaiting shipment" : "Access granted",
    detailPath: `/admin/orders/${overrides.kind}/${overrides.orderId}`,
  };
  return { ...base, ...overrides };
}

test("normalizePhysicalFulfillmentStatus matches physical-orders fallback rules", () => {
  assert.equal(normalizePhysicalFulfillmentStatus("shipped"), "shipped");
  assert.equal(normalizePhysicalFulfillmentStatus("unfulfilled"), "unfulfilled");
  assert.equal(normalizePhysicalFulfillmentStatus(null), "unfulfilled");
  assert.equal(normalizePhysicalFulfillmentStatus("garbled"), "unfulfilled");
  assert.equal(
    physicalFulfillmentLabel(normalizePhysicalFulfillmentStatus("garbled")),
    "Awaiting shipment",
  );
  assert.notEqual(
    physicalFulfillmentLabel(normalizePhysicalFulfillmentStatus("garbled")),
    "Refunded",
  );
});

test("normalizeDigitalAmountCents preserves null, zero, and positive amounts", () => {
  assert.equal(normalizeDigitalAmountCents(null), null);
  assert.equal(normalizeDigitalAmountCents(undefined), null);
  assert.equal(normalizeDigitalAmountCents(0), 0);
  assert.equal(normalizeDigitalAmountCents(1299), 1299);
  assert.equal(normalizeDigitalAmountCents("not-a-number"), null);
});

test("parseAdminOrderListFilters ignores unknown values", () => {
  const filters = parseAdminOrderListFilters(
    new URLSearchParams("kind=physical&payment=paid&fulfillment=unfulfilled&extra=1"),
  );
  assert.deepEqual(filters, {
    kind: "physical",
    payment: "paid",
    fulfillment: "unfulfilled",
  });
});

test("filterAdminOrderList applies fulfillment filters to normalized physical status", () => {
  const rows = [
    sampleRow({
      kind: "physical",
      orderId: "aaaa",
      fulfillmentStatusRaw: "unfulfilled",
    }),
    sampleRow({
      kind: "physical",
      orderId: "bbbb",
      fulfillmentStatusRaw: normalizePhysicalFulfillmentStatus("unexpected-value"),
      fulfillmentStatusLabel: physicalFulfillmentLabel("unfulfilled"),
    }),
  ];
  assert.equal(
    filterAdminOrderList(rows, {
      kind: "physical",
      payment: "all",
      fulfillment: "unfulfilled",
    }).length,
    2,
  );
  assert.equal(
    filterAdminOrderList(rows, {
      kind: "physical",
      payment: "all",
      fulfillment: "refunded",
    }).length,
    0,
  );
});

test("filterAdminOrderList filters by kind, payment, and physical fulfillment", () => {
  const rows = [
    sampleRow({
      kind: "physical",
      orderId: "bd2a25d4-6476-4c97-963e-7a03df3d75b7",
      fulfillmentStatusRaw: "unfulfilled",
    }),
    sampleRow({
      kind: "physical",
      orderId: "11111111-1111-4111-8111-111111111111",
      fulfillmentStatusRaw: "shipped",
      fulfillmentStatusLabel: "Shipped",
    }),
    sampleRow({
      kind: "digital",
      orderId: "22222222-2222-4222-8222-222222222222",
      paymentStatusRaw: "fully_refunded",
      paymentStatusLabel: "Fully refunded",
      fulfillmentStatusLabel: "Access removed after refund",
    }),
  ];

  assert.equal(
    filterAdminOrderList(rows, {
      kind: "physical",
      payment: "all",
      fulfillment: "unfulfilled",
    }).length,
    1,
  );
  assert.equal(
    filterAdminOrderList(rows, {
      kind: "all",
      payment: "fully_refunded",
      fulfillment: "all",
    }).length,
    1,
  );
  assert.equal(
    filterAdminOrderList(rows, {
      kind: "all",
      payment: "all",
      fulfillment: "shipped",
    }).length,
    1,
  );
  assert.equal(
    filterAdminOrderList(rows, {
      kind: "digital",
      payment: "all",
      fulfillment: "unfulfilled",
    }).length,
    0,
  );
});

test("sortAdminOrderList orders newest first", () => {
  const sorted = sortAdminOrderList([
    sampleRow({
      kind: "physical",
      orderId: "older",
      orderedAt: "2026-10-01T00:00:00.000Z",
    }),
    sampleRow({
      kind: "digital",
      orderId: "newer",
      orderedAt: "2026-10-19T00:00:00.000Z",
    }),
  ]);
  assert.equal(sorted[0]?.orderId, "newer");
});

test("admin orders API requires authentication", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/orders/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /isAdminAuthenticated/);
  assert.match(route, /status: 401/);
  assert.doesNotMatch(route, /export async function POST/);
});

test("admin orders list rows omit customer email fields", () => {
  const moduleSource = readFileSync(
    new URL("./admin-orders-list.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(moduleSource, /customer_email/);
  assert.doesNotMatch(moduleSource, /customer_name/);
});
