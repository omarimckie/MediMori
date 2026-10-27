import type { ShippingAddressSnapshot } from "@/lib/physical-orders";

export type OrderKind = "physical" | "digital";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OwnerLockScreenInput = {
  kind: OrderKind;
  orderId: string;
  quantity: number;
  needsAttention: boolean;
  customerName?: string | null;
  customerEmail?: string | null;
  shippingAddress?: ShippingAddressSnapshot | null;
};

export type OwnerLockScreenNotification = {
  title: string;
  body: string;
  destination: string;
};

export function isOwnerOrderNotificationDestination(path: string): boolean {
  return /^\/admin\/orders\/(physical|digital)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    path,
  );
}

export function ownerOrderDestination(kind: OrderKind, orderId: string): string {
  if (!UUID_RE.test(orderId)) {
    throw new Error("Order notification destination requires an order id.");
  }
  return `/admin/orders/${kind}/${orderId}`;
}

export function ownerPushDedupeKey(
  kind: OrderKind,
  stripeCheckoutSessionId: string,
): string {
  return `owner-push:${kind}:${stripeCheckoutSessionId.trim()}`;
}

function copyCount(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) return 1;
  return quantity;
}

/**
 * Lock-screen copy for the store owner.
 * Customer name, email, and shipping address are accepted only so callers can
 * pass an order record through; they are never interpolated into the payload.
 */
export function buildOwnerLockScreenNotification(
  input: OwnerLockScreenInput,
): OwnerLockScreenNotification {
  const copies = copyCount(input.quantity);
  const copyLabel = copies === 1 ? "1 copy" : `${copies} copies`;
  const destination = ownerOrderDestination(input.kind, input.orderId);

  if (input.kind === "physical") {
    const attention = input.needsAttention ? " and needs attention" : "";
    return {
      title: "Paperback order received",
      body: `A paid paperback order (${copyLabel}) is awaiting shipment${attention}.`,
      destination,
    };
  }

  return {
    title: "Ebook order received",
    body: `A paid ebook order (${copyLabel}) was recorded.`,
    destination,
  };
}

const PUSH_ERROR_CODES = new Set([
  "push_failed",
  "no_owner_subscriptions",
  "delivery_interrupted",
]);

export function safePushErrorCode(error: string | null | undefined): string {
  const code = error?.trim() ?? "";
  if (PUSH_ERROR_CODES.has(code)) return code;
  return "push_failed";
}
