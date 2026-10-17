import { getBookById } from "@/lib/books";
import { getPhysicalOrderById } from "@/lib/physical-orders";
import { getPurchaseById } from "@/lib/purchases";
import {
  acknowledgeOrderAttention,
  digitalItemsOrPurchaseFallback,
  getOrderAttention,
  listDigitalPurchaseItems,
} from "./repository";
import {
  presentDigitalOrder,
  presentPhysicalOrder,
  type OrderDetailView,
} from "./present-order";
import type { OrderKind } from "./privacy";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOwnerOrderRoute(
  kind: string,
  orderId: string,
): { kind: OrderKind; orderId: string } | null {
  if ((kind !== "physical" && kind !== "digital") || !UUID_RE.test(orderId)) {
    return null;
  }
  return { kind, orderId };
}

export async function loadOwnerOrderDetail(
  kind: OrderKind,
  orderId: string,
): Promise<OrderDetailView | null> {
  if (kind === "physical") {
    const order = await getPhysicalOrderById(orderId);
    if (!order) return null;
    const prior = await getOrderAttention(kind, orderId);
    const acknowledgement = await acknowledgeOrderAttention(kind, orderId);
    const book = getBookById(order.bookId);
    const flags = [
      ...order.attentionFlags,
      ...(prior?.attentionFlags ?? []),
    ];
    return presentPhysicalOrder({
      orderId: order.id,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      items: [
        {
          title: book?.title ?? order.bookId,
          quantity: order.quantity,
          unitAmountCents: order.unitPriceCents,
        },
      ],
      shippingAddress: order.shippingAddress,
      shippingAddressMissing: order.shippingAddressMissing,
      attentionFlags: flags,
      inventoryState: order.inventoryState,
      acknowledgedAt: acknowledgement.acknowledgedAt,
      justAcknowledged: acknowledgement.wasUnacknowledged,
    });
  }

  const purchase = await getPurchaseById(orderId);
  if (!purchase) return null;
  const acknowledgement = await acknowledgeOrderAttention(kind, orderId);
  const stored = await listDigitalPurchaseItems(purchase.id);
  const lines = digitalItemsOrPurchaseFallback({
    bookId: purchase.bookId,
    lines: stored,
  });
  return presentDigitalOrder({
    orderId: purchase.id,
    customerEmail: purchase.email,
    refundStatus: purchase.refundStatus,
    items: lines.map((line) => ({
      title: line.title,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
    })),
    acknowledgedAt: acknowledgement.acknowledgedAt,
    justAcknowledged: acknowledgement.wasUnacknowledged,
  });
}
