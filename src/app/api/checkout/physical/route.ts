import { hasPhysicalInventory } from "@/lib/physical-inventory";
import {
  getPhysicalBook,
  normalizePhysicalQuantity,
} from "@/lib/physical-books";
import { validateRedemptionEmail } from "@/lib/newsletter-promotion-redemption";
import { buildPhysicalCheckoutSessionCreateParams } from "@/lib/physical-checkout-session";
import { findOrCreateStripeCustomerByEmail } from "@/lib/stripe-customer";
import { ensureNewsletterPromotionCode } from "@/lib/stripe-discount";
import { getPhysicalStripePriceId } from "@/lib/stripe-physical-prices";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Payments are not configured yet (missing STRIPE_SECRET_KEY)." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const bookId =
    typeof body === "object" &&
    body !== null &&
    "bookId" in body &&
    typeof (body as { bookId: unknown }).bookId === "string"
      ? (body as { bookId: string }).bookId.trim()
      : "";

  const quantity = normalizePhysicalQuantity(
    typeof body === "object" && body !== null && "quantity" in body
      ? (body as { quantity: unknown }).quantity
      : 1,
  );

  const customerEmail =
    typeof body === "object" &&
    body !== null &&
    "customerEmail" in body &&
    typeof (body as { customerEmail: unknown }).customerEmail === "string"
      ? (body as { customerEmail: string }).customerEmail.trim()
      : "";

  if (!bookId) {
    return NextResponse.json({ error: "bookId is required." }, { status: 400 });
  }

  if (!quantity) {
    return NextResponse.json({ error: "Invalid quantity." }, { status: 400 });
  }

  const emailValidation = validateRedemptionEmail(customerEmail);
  if (!emailValidation.ok) {
    return NextResponse.json(
      { error: "A valid email is required for checkout." },
      { status: 400 },
    );
  }

  const book = getPhysicalBook(bookId);
  if (!book) {
    return NextResponse.json(
      { error: "This title is not available for direct paperback purchase." },
      { status: 400 },
    );
  }

  const priceId = getPhysicalStripePriceId(book);
  if (!priceId?.startsWith("price_")) {
    return NextResponse.json(
      {
        error:
          "Direct paperback checkout is not configured yet (missing stripePriceIdPhysical or test price env).",
      },
      { status: 503 },
    );
  }

  const inStock = await hasPhysicalInventory(book.id, quantity);
  if (!inStock) {
    return NextResponse.json(
      { error: "Direct copies are currently unavailable for this title." },
      { status: 409 },
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) {
    return NextResponse.json(
      { error: "Site URL is not configured (NEXT_PUBLIC_SITE_URL)." },
      { status: 503 },
    );
  }

  const stripe = new Stripe(secret);

  try {
    await ensureNewsletterPromotionCode(stripe).catch((error) => {
      console.error("Could not ensure newsletter promotion code:", error);
    });

    const normalizedEmail = emailValidation.email;
    const stripeCustomerId = await findOrCreateStripeCustomerByEmail(
      stripe,
      normalizedEmail,
    );

    const params = buildPhysicalCheckoutSessionCreateParams({
      bookId: book.id,
      quantity,
      priceId,
      successUrl: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/books/${book.id}`,
      customerEmail: normalizedEmail,
      stripeCustomerId,
    });

    const session = await stripe.checkout.sessions.create(params);

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stripe error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
