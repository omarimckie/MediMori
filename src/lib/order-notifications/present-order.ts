import type { ShippingAddressSnapshot } from "@/lib/physical-orders";
import type { RefundStatus } from "@/lib/purchases";
import { inventoryDiscrepancyBlocksShipment } from "./inventory-resolution";
import type { OrderKind } from "./privacy";

export type PhysicalFulfillmentStatus =
  | "unfulfilled"
  | "shipped"
  | "cancelled"
  | "refunded";

export const AWAITING_SHIPMENT_STATUS = "unfulfilled" as const;

export type ShippingField = {
  label: string;
  value: string | null;
};

export type OrderDetailItem = {
  title: string;
  quantity: number;
  unitAmountCents: number | null;
};

export type OrderDetailView = {
  kind: OrderKind;
  orderId: string;
  customerName: string | null;
  customerEmail: string | null;
  paymentStatus: string;
  fulfillmentStatus: string;
  items: OrderDetailItem[];
  shippingFields: ShippingField[] | null;
  shippingException: string | null;
  attention: string[];
  unacknowledged: boolean;
  acknowledgementLabel: string;
  canMarkShipped: boolean;
  inventoryDiscrepancyOpen: boolean;
};

const ATTENTION_COPY: Record<string, string> = {
  missing_shipping_address: "Shipping address was not provided with this paid order.",
  inventory_processing_failed:
    "Inventory processing failed. This paid order was kept for attention.",
  inventory_processing_incomplete:
    "Inventory processing did not finish. Verify stock before shipping. This order stays unshipped until that discrepancy is acknowledged, and stock will not be decremented again.",
  inventory_discrepancy_acknowledged:
    "Inventory discrepancy acknowledged. Stock was not changed.",
};

export function fulfillmentAfterExplicitShip(
  status: PhysicalFulfillmentStatus,
): "shipped" | null {
  if (status !== AWAITING_SHIPMENT_STATUS) return null;
  return "shipped";
}

export function completeShippingFields(
  address: ShippingAddressSnapshot,
): ShippingField[] {
  return [
    { label: "Name", value: blankToNull(address.name) },
    { label: "Address line 1", value: blankToNull(address.line1) },
    { label: "Address line 2", value: blankToNull(address.line2) },
    { label: "City", value: blankToNull(address.city) },
    { label: "State", value: blankToNull(address.state) },
    { label: "Postal code", value: blankToNull(address.postalCode) },
    { label: "Country", value: blankToNull(address.country) },
  ];
}

export function physicalPaymentLabel(status: string): string {
  if (status === "paid") return "Paid";
  if (status === "refunded") return "Refunded";
  if (status === "partially_refunded") return "Partially refunded";
  return "Paid";
}

export function physicalFulfillmentLabel(status: PhysicalFulfillmentStatus): string {
  if (status === "unfulfilled") return "Awaiting shipment";
  if (status === "shipped") return "Shipped";
  if (status === "cancelled") return "Cancelled";
  return "Refunded";
}

export function digitalPaymentLabel(status: RefundStatus): string {
  if (status === "partially_refunded") return "Partially refunded";
  if (status === "fully_refunded") return "Fully refunded";
  return "Paid";
}

export function digitalFulfillmentLabel(status: RefundStatus): string {
  if (status === "fully_refunded") return "Access removed after refund";
  return "Access granted";
}

export function attentionMessages(flags: string[]): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const flag of flags) {
    const message = ATTENTION_COPY[flag];
    if (!message || seen.has(message)) continue;
    seen.add(message);
    messages.push(message);
  }
  return messages;
}

export function acknowledgeOrderRecord(
  record: { acknowledgedAt: Date | null },
  now: Date,
): { acknowledgedAt: Date; wasUnacknowledged: boolean } {
  if (record.acknowledgedAt) {
    return { acknowledgedAt: record.acknowledgedAt, wasUnacknowledged: false };
  }
  return { acknowledgedAt: now, wasUnacknowledged: true };
}

export function listUnacknowledged<T extends { acknowledgedAt: Date | null }>(
  rows: T[],
): T[] {
  return rows.filter((row) => row.acknowledgedAt == null);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function formatAcknowledgedAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(value);
}

export function presentPhysicalOrder(input: {
  orderId: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: string;
  fulfillmentStatus: PhysicalFulfillmentStatus;
  items: OrderDetailItem[];
  shippingAddress: ShippingAddressSnapshot;
  shippingAddressMissing: boolean;
  attentionFlags: string[];
  inventoryState: "pending" | "processing" | "applied" | "failed";
  acknowledgedAt: Date | null;
  justAcknowledged: boolean;
}): OrderDetailView {
  const flags = [...input.attentionFlags];
  if (input.shippingAddressMissing && !flags.includes("missing_shipping_address")) {
    flags.push("missing_shipping_address");
  }
  if (
    input.inventoryState === "failed" &&
    !flags.includes("inventory_processing_failed")
  ) {
    flags.push("inventory_processing_failed");
  }
  if (
    input.inventoryState === "processing" &&
    !flags.includes("inventory_processing_incomplete")
  ) {
    flags.push("inventory_processing_incomplete");
  }

  const shippingException = flags.includes("missing_shipping_address")
    ? ATTENTION_COPY.missing_shipping_address
    : null;
  const inventoryDiscrepancyOpen = inventoryDiscrepancyBlocksShipment({
    inventoryState: input.inventoryState,
    attentionFlags: flags,
  });

  return {
    kind: "physical",
    orderId: input.orderId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    paymentStatus: physicalPaymentLabel(input.paymentStatus),
    fulfillmentStatus: physicalFulfillmentLabel(input.fulfillmentStatus),
    items: input.items,
    shippingFields: completeShippingFields(input.shippingAddress),
    shippingException,
    attention: attentionMessages(flags),
    unacknowledged: input.acknowledgedAt == null && !input.justAcknowledged,
    acknowledgementLabel: acknowledgementLabel(
      input.acknowledgedAt,
      input.justAcknowledged,
    ),
    canMarkShipped:
      fulfillmentAfterExplicitShip(input.fulfillmentStatus) === "shipped" &&
      !inventoryDiscrepancyOpen,
    inventoryDiscrepancyOpen,
  };
}

export function presentDigitalOrder(input: {
  orderId: string;
  customerEmail: string;
  refundStatus: RefundStatus;
  items: OrderDetailItem[];
  acknowledgedAt: Date | null;
  justAcknowledged: boolean;
}): OrderDetailView {
  return {
    kind: "digital",
    orderId: input.orderId,
    customerName: null,
    customerEmail: input.customerEmail,
    paymentStatus: digitalPaymentLabel(input.refundStatus),
    fulfillmentStatus: digitalFulfillmentLabel(input.refundStatus),
    items: input.items,
    shippingFields: null,
    shippingException: null,
    attention: [],
    unacknowledged: input.acknowledgedAt == null && !input.justAcknowledged,
    acknowledgementLabel: acknowledgementLabel(
      input.acknowledgedAt,
      input.justAcknowledged,
    ),
    canMarkShipped: false,
    inventoryDiscrepancyOpen: false,
  };
}

function acknowledgementLabel(
  acknowledgedAt: Date | null,
  justAcknowledged: boolean,
): string {
  if (justAcknowledged) {
    return acknowledgedAt
      ? `Marked reviewed when you opened this order (${formatAcknowledgedAt(acknowledgedAt)}).`
      : "Marked reviewed when you opened this order.";
  }
  if (!acknowledgedAt) return "Unacknowledged.";
  return `Reviewed ${formatAcknowledgedAt(acknowledgedAt)}.`;
}
