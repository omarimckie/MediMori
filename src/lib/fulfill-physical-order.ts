import type Stripe from "stripe";
import { getSql } from "./db";
import { decrementPhysicalInventory } from "./physical-inventory";
import { refundStripePaymentIntent } from "./stripe-payment-refund";
import {
  getPhysicalOrderByCheckoutSessionId,
  insertPhysicalOrder,
  type PhysicalOrderRow,
} from "./physical-orders";
import type { VerifiedPhysicalCheckout } from "./physical-checkout-ownership";

export type FulfillPhysicalOrderResult =
  | { ok: true; duplicate: boolean; order: PhysicalOrderRow }
  | { ok: false; refunded: boolean; reason: string };

async function markPhysicalOrderRefunded(orderId: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE physical_orders
    SET fulfillment_status = 'refunded', updated_at = NOW()
    WHERE id = ${orderId}::uuid
  `;
}

/**
 * Claims the checkout session via unique insert, decrements inventory once, and records the order.
 * Idempotent per stripe_checkout_session_id. Refunds if inventory is unavailable.
 */
export async function fulfillPhysicalOrder(
  stripe: Stripe,
  verified: VerifiedPhysicalCheckout,
): Promise<FulfillPhysicalOrderResult> {
  const { created, order } = await insertPhysicalOrder({
    stripeCheckoutSessionId: verified.stripeCheckoutSessionId,
    stripePaymentIntentId: verified.stripePaymentIntentId,
    bookId: verified.bookId,
    quantity: verified.quantity,
    unitPriceCents: verified.unitPriceCents,
    shippingPriceCents: verified.shippingPriceCents,
    totalAmountCents: verified.amountCents,
    customerName: verified.customerName,
    customerEmail: verified.customerEmail,
    shippingAddress: verified.shippingAddress,
    fulfillmentStatus: "unfulfilled",
  });

  if (!created) {
    const duplicate = await getPhysicalOrderByCheckoutSessionId(
      verified.stripeCheckoutSessionId,
    );
    if (!duplicate) {
      throw new Error("Physical order claim failed.");
    }
    return { ok: true, duplicate: true, order: duplicate };
  }

  const remaining = await decrementPhysicalInventory(
    verified.bookId,
    verified.quantity,
  );

  if (remaining === null) {
    await markPhysicalOrderRefunded(order.id);
    let refunded = false;
    if (verified.stripePaymentIntentId) {
      refunded = await refundStripePaymentIntent(
        stripe,
        verified.stripePaymentIntentId,
      );
    }
    return {
      ok: false,
      refunded,
      reason: "inventory_unavailable",
    };
  }

  const finalOrder =
    (await getPhysicalOrderByCheckoutSessionId(
      verified.stripeCheckoutSessionId,
    )) ?? order;

  return { ok: true, duplicate: false, order: finalOrder };
}
