import type Stripe from "stripe";

export async function refundStripePaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<boolean> {
  try {
    await stripe.refunds.create({ payment_intent: paymentIntentId });
    return true;
  } catch (error) {
    console.error("Could not refund Stripe payment:", {
      paymentIntentId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

export function paymentIntentIdFromCheckoutSession(
  session: Stripe.Checkout.Session,
): string | null {
  const paymentIntent = session.payment_intent;
  if (!paymentIntent) return null;
  if (typeof paymentIntent === "string") return paymentIntent;
  return paymentIntent.id ?? null;
}
