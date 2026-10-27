import {
  CheckoutSessionSummaryError,
  isValidCheckoutSessionId,
  resolveCheckoutSessionSummary,
} from "@/lib/checkout-session-summary";
import { getPhysicalOrderByCheckoutSessionId } from "@/lib/physical-orders";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Payments are not configured (missing STRIPE_SECRET_KEY)." },
      { status: 503 },
    );
  }

  const sessionId = new URL(request.url).searchParams.get("session_id")?.trim();
  if (!sessionId || !isValidCheckoutSessionId(sessionId)) {
    return NextResponse.json({ error: "Invalid session_id." }, { status: 400 });
  }

  const stripe = new Stripe(secret);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired checkout session." },
      { status: 400 },
    );
  }

  let orderRecorded = false;
  try {
    const order = await getPhysicalOrderByCheckoutSessionId(sessionId);
    orderRecorded = Boolean(order);
  } catch {
    orderRecorded = false;
  }

  try {
    const summary = resolveCheckoutSessionSummary(session, orderRecorded);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof CheckoutSessionSummaryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Could not load checkout session summary." },
      { status: 500 },
    );
  }
}
