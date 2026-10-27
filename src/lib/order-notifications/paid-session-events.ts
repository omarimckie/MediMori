const PAID_CHECKOUT_FULFILLMENT_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
] as const;

export type CheckoutPaymentAcknowledgement =
  | { fulfill: true }
  | { fulfill: false; httpStatus: 200 | 402 };

export function isPaidCheckoutFulfillmentEvent(eventType: string): boolean {
  return (PAID_CHECKOUT_FULFILLMENT_EVENTS as readonly string[]).includes(eventType);
}

/**
 * Paid sessions of either fulfillment event continue into the shared path.
 * An unpaid completion is a normal delayed-payment signal and is acknowledged.
 * An async success event that is not yet paid stays retriable.
 */
export function checkoutPaymentAcknowledgement(
  eventType: string,
  paymentStatus: string | null | undefined,
): CheckoutPaymentAcknowledgement {
  if (paymentStatus === "paid") return { fulfill: true };
  if (eventType === "checkout.session.completed") {
    return { fulfill: false, httpStatus: 200 };
  }
  return { fulfill: false, httpStatus: 402 };
}
