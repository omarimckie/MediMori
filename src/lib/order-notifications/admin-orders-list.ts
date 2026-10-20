import { getBookById } from "@/lib/books";
import { getSql } from "@/lib/db";
import type { PhysicalFulfillmentStatus } from "@/lib/physical-orders";
import type { RefundStatus } from "@/lib/purchases";
import {
  digitalFulfillmentLabel,
  digitalPaymentLabel,
  physicalFulfillmentLabel,
  physicalPaymentLabel,
} from "./present-order";
import type { OrderKind } from "./privacy";
import { ownerOrderDestination } from "./privacy";

export type AdminOrderKindFilter = "all" | OrderKind;

export type AdminOrderPaymentFilter =
  | "all"
  | "paid"
  | "refunded"
  | "partially_refunded"
  | "fully_refunded"
  | "unpaid";

export type AdminOrderFulfillmentFilter =
  | "all"
  | PhysicalFulfillmentStatus;

export type AdminOrderListFilters = {
  kind: AdminOrderKindFilter;
  payment: AdminOrderPaymentFilter;
  fulfillment: AdminOrderFulfillmentFilter;
};

export type AdminOrderListRow = {
  kind: OrderKind;
  orderId: string;
  orderedAt: string;
  bookId: string;
  productTitle: string;
  quantity: number;
  /** Null means the stored purchase amount is unavailable (digital only). */
  totalAmountCents: number | null;
  paymentStatusRaw: string;
  paymentStatusLabel: string;
  fulfillmentStatusRaw: string | null;
  fulfillmentStatusLabel: string;
  detailPath: string;
};

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function bookTitle(bookId: string): string {
  return getBookById(bookId)?.title ?? bookId;
}

/**
 * Same acceptance rules and fallback as `mapFulfillmentStatus` in physical-orders.ts.
 * Kept here so the list view stays within the orders-dashboard module boundary.
 */
export function normalizePhysicalFulfillmentStatus(
  value: unknown,
): PhysicalFulfillmentStatus {
  if (
    value === "unfulfilled" ||
    value === "shipped" ||
    value === "cancelled" ||
    value === "refunded"
  ) {
    return value;
  }
  return "unfulfilled";
}

/** Distinguishes a missing amount from a genuine zero-cent total. */
export function normalizeDigitalAmountCents(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const cents = Number(value);
  return Number.isFinite(cents) ? cents : null;
}

export function parseAdminOrderListFilters(
  params: URLSearchParams,
): AdminOrderListFilters {
  const kind = params.get("kind");
  const payment = params.get("payment");
  const fulfillment = params.get("fulfillment");

  const kindFilter: AdminOrderKindFilter =
    kind === "physical" || kind === "digital" ? kind : "all";

  const paymentFilter: AdminOrderPaymentFilter =
    payment === "paid" ||
    payment === "refunded" ||
    payment === "partially_refunded" ||
    payment === "fully_refunded" ||
    payment === "unpaid"
      ? payment
      : "all";

  const fulfillmentFilter: AdminOrderFulfillmentFilter =
    fulfillment === "unfulfilled" ||
    fulfillment === "shipped" ||
    fulfillment === "cancelled" ||
    fulfillment === "refunded"
      ? fulfillment
      : "all";

  return {
    kind: kindFilter,
    payment: paymentFilter,
    fulfillment: fulfillmentFilter,
  };
}

export function filterAdminOrderList(
  rows: AdminOrderListRow[],
  filters: AdminOrderListFilters,
): AdminOrderListRow[] {
  return rows.filter((row) => {
    if (filters.kind !== "all" && row.kind !== filters.kind) {
      return false;
    }
    if (filters.payment !== "all" && row.paymentStatusRaw !== filters.payment) {
      return false;
    }
    if (filters.fulfillment !== "all") {
      if (row.kind !== "physical") {
        return false;
      }
      if (row.fulfillmentStatusRaw !== filters.fulfillment) {
        return false;
      }
    }
    return true;
  });
}

export function sortAdminOrderList(rows: AdminOrderListRow[]): AdminOrderListRow[] {
  return [...rows].sort(
    (a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt),
  );
}

export async function listAdminOrdersForDashboard(): Promise<AdminOrderListRow[]> {
  const sql = getSql();
  const physicalRows = await sql`
    SELECT
      id,
      book_id,
      quantity,
      total_amount_cents,
      payment_status,
      fulfillment_status,
      purchased_at
    FROM physical_orders
    ORDER BY purchased_at DESC
  `;
  const digitalRows = await sql`
    SELECT
      id,
      book_id,
      amount_cents,
      refund_status,
      purchased_at,
      COALESCE((
        SELECT SUM(items.quantity)::int
        FROM digital_purchase_items AS items
        WHERE items.purchase_id = purchases.id
      ), 1) AS quantity
    FROM purchases
    ORDER BY purchased_at DESC
  `;

  const physical = physicalRows.map((row) => {
    const record = row as Record<string, unknown>;
    const orderId = String(record.id);
    const paymentStatus =
      record.payment_status == null ? "paid" : String(record.payment_status);
    const fulfillmentStatus = normalizePhysicalFulfillmentStatus(
      record.fulfillment_status,
    );
    return {
      kind: "physical" as const,
      orderId,
      orderedAt: asDate(record.purchased_at).toISOString(),
      bookId: String(record.book_id),
      productTitle: bookTitle(String(record.book_id)),
      quantity: Number(record.quantity),
      totalAmountCents: Number(record.total_amount_cents),
      paymentStatusRaw: paymentStatus,
      paymentStatusLabel: physicalPaymentLabel(paymentStatus),
      fulfillmentStatusRaw: fulfillmentStatus,
      fulfillmentStatusLabel: physicalFulfillmentLabel(fulfillmentStatus),
      detailPath: ownerOrderDestination("physical", orderId),
    };
  });

  const digital = digitalRows.map((row) => {
    const record = row as Record<string, unknown>;
    const orderId = String(record.id);
    const refundStatus = String(record.refund_status ?? "paid") as RefundStatus;
    const amountCents = normalizeDigitalAmountCents(record.amount_cents);
    return {
      kind: "digital" as const,
      orderId,
      orderedAt: asDate(record.purchased_at).toISOString(),
      bookId: String(record.book_id),
      productTitle: bookTitle(String(record.book_id)),
      quantity: Number(record.quantity ?? 1),
      totalAmountCents: amountCents,
      paymentStatusRaw: refundStatus,
      paymentStatusLabel: digitalPaymentLabel(refundStatus),
      fulfillmentStatusRaw: null,
      fulfillmentStatusLabel: digitalFulfillmentLabel(refundStatus),
      detailPath: ownerOrderDestination("digital", orderId),
    };
  });

  return sortAdminOrderList([...physical, ...digital]);
}
