import type Stripe from "stripe";
import { decrementPhysicalInventory } from "./physical-inventory";
import {
  claimPhysicalInventoryProcessing,
  getPhysicalOrderByCheckoutSessionId,
  insertPhysicalOrder,
  markPhysicalInventoryApplied,
  markPhysicalInventoryFailed,
  type PhysicalOrderRow,
} from "./physical-orders";
import type { VerifiedPhysicalCheckout } from "./physical-checkout-ownership";

export type FulfillPhysicalOrderResult = {
  ok: true;
  duplicate: boolean;
  order: PhysicalOrderRow;
  inventoryProcessingFailed: boolean;
};

export type PhysicalFulfillmentDeps = {
  insertPhysicalOrder: typeof insertPhysicalOrder;
  claimPhysicalInventoryProcessing: typeof claimPhysicalInventoryProcessing;
  decrementPhysicalInventory: typeof decrementPhysicalInventory;
  markPhysicalInventoryApplied: typeof markPhysicalInventoryApplied;
  markPhysicalInventoryFailed: typeof markPhysicalInventoryFailed;
  getPhysicalOrderByCheckoutSessionId: typeof getPhysicalOrderByCheckoutSessionId;
};

const defaultPhysicalFulfillmentDeps: PhysicalFulfillmentDeps = {
  insertPhysicalOrder,
  claimPhysicalInventoryProcessing,
  decrementPhysicalInventory,
  markPhysicalInventoryApplied,
  markPhysicalInventoryFailed,
  getPhysicalOrderByCheckoutSessionId,
};

/**
 * Records a paid physical order before inventory processing.
 * Inventory failure keeps the paid order and flags it; it does not refund.
 * A duplicate checkout session does not decrement inventory twice.
 */
export async function fulfillPhysicalOrder(
  _stripe: Stripe,
  verified: VerifiedPhysicalCheckout,
  deps: PhysicalFulfillmentDeps = defaultPhysicalFulfillmentDeps,
): Promise<FulfillPhysicalOrderResult> {
  const attentionFlags = verified.shippingAddressMissing
    ? ["missing_shipping_address"]
    : [];

  const { created } = await deps.insertPhysicalOrder({
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
    shippingAddressMissing: verified.shippingAddressMissing,
    attentionFlags,
    fulfillmentStatus: "unfulfilled",
  });

  const claim = await deps.claimPhysicalInventoryProcessing(
    verified.stripeCheckoutSessionId,
  );

  if (claim === "claimed") {
    let inventoryFailed = false;
    try {
      const remaining = await deps.decrementPhysicalInventory(
        verified.bookId,
        verified.quantity,
      );
      inventoryFailed = remaining === null;
    } catch {
      inventoryFailed = true;
    }

    const current = await deps.getPhysicalOrderByCheckoutSessionId(
      verified.stripeCheckoutSessionId,
    );
    if (!current) {
      throw new Error("Physical order claim failed.");
    }

    if (inventoryFailed) {
      await deps.markPhysicalInventoryFailed(current.id);
    } else {
      await deps.markPhysicalInventoryApplied(current.id);
    }
  }

  const order = await deps.getPhysicalOrderByCheckoutSessionId(
    verified.stripeCheckoutSessionId,
  );
  if (!order) {
    throw new Error("Physical order was not recorded.");
  }

  return {
    ok: true,
    duplicate: !created,
    order,
    inventoryProcessingFailed: order.inventoryState === "failed",
  };
}
