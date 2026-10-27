import { evaluatePaidCheckout } from "@/lib/checkout-ownership";
import {
  sendLibraryAccessEmail,
  sendPhysicalFulfillmentNotificationEmail,
  sendPhysicalOrderConfirmationEmail,
} from "@/lib/email";
import { fulfillPhysicalOrder } from "@/lib/fulfill-physical-order";
import { evaluatePaidPhysicalCheckout, isPhysicalCheckoutSession } from "@/lib/physical-checkout-ownership";
import { createLibraryAccessUrl } from "@/lib/magic-link";
import { itemizedDigitalLinesFromSession, persistItemizedDigitalPurchase } from "@/lib/order-notifications/digital-lines";
import { ensureOwnerOrderPushLive, retryFailedOwnerOrderPushesLive } from "@/lib/order-notifications/owner-push-live";
import { recordDigitalPurchaseItems } from "@/lib/order-notifications/repository";
import {
  checkoutPaymentAcknowledgement,
  isPaidCheckoutFulfillmentEvent,
} from "@/lib/order-notifications/paid-session-events";
import { paidOrderWebhookHttpStatus } from "@/lib/order-notifications/webhook-ack";
import { recordStripeRefundAndRecompute } from "@/lib/purchase-refunds";
import { ensurePaidNewsletterRedemptionBeforeFulfillment } from "@/lib/newsletter-promotion-redemption";
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
      expand: [
        "line_items.data.price",
        "payment_intent.latest_charge",
        "discounts.promotion_code",
        "discounts.promotion_code.promotion.coupon",
      ],
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

  if (!isPaidCheckoutFulfillmentEvent(event.type)) {
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

  const acknowledgement = checkoutPaymentAcknowledgement(
    event.type,
    session.payment_status,
  );
  if (!acknowledgement.fulfill) {
    if (acknowledgement.httpStatus === 200) {
      return NextResponse.json({ received: true });
    }
    return NextResponse.json(
      { error: "Checkout session is not paid." },
      { status: acknowledgement.httpStatus },
    );
  }

  if (isPhysicalCheckoutSession(session)) {
    const physicalEvaluation = evaluatePaidPhysicalCheckout(session);
    if (!physicalEvaluation.ok) {
      return NextResponse.json(
        { error: physicalEvaluation.error },
        { status: physicalEvaluation.status },
      );
    }

    const newsletterGate = await ensurePaidNewsletterRedemptionBeforeFulfillment(
      stripe,
      session,
      {
        purchaseType: "physical",
        bookId: physicalEvaluation.order.bookId,
        quantity: physicalEvaluation.order.quantity,
      },
    );
    if (!newsletterGate.ok) {
      return NextResponse.json({
        received: true,
        physicalFulfillment: newsletterGate.reason,
        refunded: newsletterGate.refunded,
      });
    }

    let fulfillment;
    try {
      fulfillment = await fulfillPhysicalOrder(stripe, physicalEvaluation.order);
    } catch (error) {
      console.error("Physical order could not be recorded:", {
        sessionId: physicalEvaluation.order.stripeCheckoutSessionId,
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        { error: "Physical order could not be recorded." },
        {
          status: paidOrderWebhookHttpStatus({
            orderPersisted: false,
            notificationJobPersisted: false,
          }),
        },
      );
    }

    let notification;
    try {
      notification = await ensureOwnerOrderPushLive({
        kind: "physical",
        orderId: fulfillment.order.id,
        quantity: fulfillment.order.quantity,
        needsAttention:
          fulfillment.inventoryProcessingFailed ||
          fulfillment.order.shippingAddressMissing,
        stripeCheckoutSessionId: fulfillment.order.stripeCheckoutSessionId,
        stripeEventId: event.id,
        attentionFlags: fulfillment.order.attentionFlags,
        customerName: fulfillment.order.customerName,
        customerEmail: fulfillment.order.customerEmail,
        shippingAddress: fulfillment.order.shippingAddress,
      });
    } catch (error) {
      console.error("Order notification could not be recorded:", {
        sessionId: fulfillment.order.stripeCheckoutSessionId,
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        { error: "Order notification could not be recorded." },
        {
          status: paidOrderWebhookHttpStatus({
            orderPersisted: true,
            notificationJobPersisted: false,
          }),
        },
      );
    }

    if (
      paidOrderWebhookHttpStatus({
        orderPersisted: true,
        notificationJobPersisted: notification.jobPersisted,
      }) !== 200
    ) {
      return NextResponse.json(
        { error: "Order notification could not be recorded." },
        { status: 500 },
      );
    }

    if (
      !fulfillment.duplicate &&
      !fulfillment.inventoryProcessingFailed &&
      !fulfillment.order.shippingAddressMissing
    ) {
      try {
        await sendPhysicalOrderConfirmationEmail(fulfillment.order);
        await sendPhysicalFulfillmentNotificationEmail(fulfillment.order);
      } catch (error) {
        console.error("Could not send physical order emails:", {
          orderId: fulfillment.order.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    try {
      await retryFailedOwnerOrderPushesLive();
    } catch (error) {
      console.error("Could not retry owner order notifications:", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    return NextResponse.json({
      received: true,
      physicalFulfillment: fulfillment.inventoryProcessingFailed
        ? "inventory_needs_attention"
        : "ok",
      ownerPushDelivered: notification.pushDelivered,
    });
  }

  const evaluation = evaluatePaidCheckout(session);
  if (!evaluation.ok) {
    return NextResponse.json(
      { error: evaluation.error },
      { status: evaluation.status },
    );
  }

  const newsletterGate = await ensurePaidNewsletterRedemptionBeforeFulfillment(
    stripe,
    session,
    {
      purchaseType: "ebook",
      bookId: evaluation.purchase.bookId,
    },
  );
  if (!newsletterGate.ok) {
    return NextResponse.json({
      received: true,
      ebookFulfillment: newsletterGate.reason,
      refunded: newsletterGate.refunded,
    });
  }

  const digitalLines = itemizedDigitalLinesFromSession(
    session,
    evaluation.purchase.bookId,
  );
  const digitalQuantity = digitalLines.reduce((sum, line) => sum + line.quantity, 0);

  let purchaseId = "";
  let purchaseEmail = "";
  let purchaseSessionId = "";
  try {
    const saved = await recordPurchaseAndEntitlement(evaluation.purchase);
    purchaseId = saved.purchase.id;
    purchaseEmail = saved.purchase.email;
    purchaseSessionId = saved.purchase.stripeCheckoutSessionId;
    await persistItemizedDigitalPurchase(digitalLines, (items) =>
      recordDigitalPurchaseItems(saved.purchase.id, items),
    );
  } catch (error) {
    console.error("Could not record eBook purchase:", {
      sessionId: evaluation.purchase.stripeCheckoutSessionId,
      bookId: evaluation.purchase.bookId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Purchase could not be recorded." },
      {
        status: paidOrderWebhookHttpStatus({
          orderPersisted: false,
          notificationJobPersisted: false,
        }),
      },
    );
  }

  let digitalNotification;
  try {
    digitalNotification = await ensureOwnerOrderPushLive({
      kind: "digital",
      orderId: purchaseId,
      quantity: digitalQuantity,
      needsAttention: false,
      stripeCheckoutSessionId: purchaseSessionId,
      stripeEventId: event.id,
      attentionFlags: [],
      customerEmail: purchaseEmail,
    });
  } catch (error) {
    console.error("Order notification could not be recorded:", {
      sessionId: purchaseSessionId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Order notification could not be recorded." },
      {
        status: paidOrderWebhookHttpStatus({
          orderPersisted: true,
          notificationJobPersisted: false,
        }),
      },
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

  try {
    await retryFailedOwnerOrderPushesLive();
  } catch (error) {
    console.error("Could not retry owner order notifications:", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return NextResponse.json({
    received: true,
    ownerPushDelivered: digitalNotification.pushDelivered,
  });
}
