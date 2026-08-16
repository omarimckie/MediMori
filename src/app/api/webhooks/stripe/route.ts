import { evaluatePaidCheckout } from "@/lib/checkout-ownership";
import { sendLibraryAccessEmail } from "@/lib/email";
import { createLibraryAccessUrl } from "@/lib/magic-link";
import { recordStripeRefundAndRecompute } from "@/lib/purchase-refunds";
import { recordPurchaseAndEntitlement } from "@/lib/purchases";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

async function loadSessionWithLineItems(
  stripe: Stripe,
  sessionId: string,
): Promise<Stripe.Checkout.Session | null> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items.data.price", "payment_intent.latest_charge"],
    });
  } catch {
    return null;
  }

  let lineItems = session.line_items?.data ?? [];
  if (!lineItems.length) {
    try {
      const listed = await stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 10,
        expand: ["data.price"],
      });
      lineItems = listed.data;
    } catch {
      try {
        const listed = await stripe.checkout.sessions.listLineItems(sessionId, {
          limit: 10,
        });
        lineItems = listed.data;
      } catch {
        lineItems = [];
      }
    }
  }

  session.line_items = {
    object: "list",
    data: lineItems,
    has_more: false,
    url: session.line_items?.url ?? "",
  };

  return session;
}

function refundPaymentIntentId(refund: Stripe.Refund): string | null {
  const paymentIntent = refund.payment_intent;
  if (!paymentIntent) return null;
  if (typeof paymentIntent === "string") return paymentIntent;
  return paymentIntent.id ?? null;
}

function refundChargeId(
  refund: Stripe.Refund,
  fallbackChargeId?: string | null,
): string | null {
  const charge = refund.charge;
  if (typeof charge === "string") return charge;
  if (charge && typeof charge === "object" && "id" in charge) {
    return charge.id ?? fallbackChargeId ?? null;
  }
  return fallbackChargeId ?? null;
}

function chargeId(charge: Stripe.Charge): string | null {
  return charge.id ?? null;
}

function stripeRefundToRecord(
  refund: Stripe.Refund,
  fallbackChargeId?: string | null,
) {
  const succeeded = refund.status === "succeeded";
  return {
    stripeRefundId: refund.id,
    amountCents: refund.amount,
    currency: refund.currency,
    status: refund.status ?? "pending",
    stripeChargeId: refundChargeId(refund, fallbackChargeId),
    stripePaymentIntentId: refundPaymentIntentId(refund),
    reason: refund.reason ? String(refund.reason) : null,
    processedAt: succeeded
      ? new Date((refund.created ?? 0) * 1000)
      : null,
  };
}

async function listChargeRefunds(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<Stripe.Refund[]> {
  const embedded = charge.refunds?.data;
  if (embedded?.length) return embedded;
  const listed = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  return listed.data;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured (missing STRIPE_WEBHOOK_SECRET)." },
      { status: 503 },
    );
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json(
      { error: "Payments are not configured (missing STRIPE_SECRET_KEY)." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  const stripe = new Stripe(stripeSecret);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json(
      { error: "Invalid Stripe signature." },
      { status: 400 },
    );
  }

  if (
    event.type === "refund.created" ||
    event.type === "refund.updated" ||
    event.type === "refund.failed"
  ) {
    const refund = event.data.object as Stripe.Refund;
    try {
      const result = await recordStripeRefundAndRecompute(
        stripeRefundToRecord(refund),
      );
      if (result.unmatched) {
        console.error("Refund webhook did not match a purchase:", {
          refundId: refund.id,
          paymentIntent: refundPaymentIntentId(refund),
        });
        return NextResponse.json({ received: true, unmatched: true });
      }
    } catch (error) {
      console.error("Could not record Stripe refund:", {
        refundId: refund.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        { error: "Refund could not be recorded." },
        { status: 500 },
      );
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    try {
      const refunds = await listChargeRefunds(stripe, charge);
      for (const refund of refunds) {
        const result = await recordStripeRefundAndRecompute(
          stripeRefundToRecord(refund, chargeId(charge)),
        );
        if (result.unmatched) {
          console.error("Charge refund did not match a purchase:", {
            refundId: refund.id,
            chargeId: charge.id,
          });
        }
      }
    } catch (error) {
      console.error("Could not record charge refunds:", {
        chargeId: charge.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        { error: "Refund could not be recorded." },
        { status: 500 },
      );
    }
    return NextResponse.json({ received: true });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const eventSession = event.data.object as Stripe.Checkout.Session;
  if (!eventSession?.id) {
    return NextResponse.json(
      { error: "Checkout session is missing." },
      { status: 400 },
    );
  }

  const session = await loadSessionWithLineItems(stripe, eventSession.id);
  if (!session) {
    return NextResponse.json(
      { error: "Checkout session could not be retrieved." },
      { status: 400 },
    );
  }

  const evaluation = evaluatePaidCheckout(session);
  if (!evaluation.ok) {
    return NextResponse.json(
      { error: evaluation.error },
      { status: evaluation.status },
    );
  }

  try {
    await recordPurchaseAndEntitlement(evaluation.purchase);
  } catch (error) {
    console.error("Could not record eBook purchase:", {
      sessionId: evaluation.purchase.stripeCheckoutSessionId,
      bookId: evaluation.purchase.bookId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Purchase could not be recorded." },
      { status: 500 },
    );
  }

  try {
    const accessUrl = await createLibraryAccessUrl(evaluation.purchase.email);
    if (accessUrl) {
      await sendLibraryAccessEmail(evaluation.purchase.email, accessUrl);
    }
  } catch (error) {
    console.error("Could not send purchase access email:", {
      sessionId: evaluation.purchase.stripeCheckoutSessionId,
      bookId: evaluation.purchase.bookId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return NextResponse.json({ received: true });
}
