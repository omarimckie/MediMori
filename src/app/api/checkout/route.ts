import { getBookById } from "@/lib/books";
import { NextResponse } from "next/server";
import Stripe from "stripe";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

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
      ? (body as { bookId: string }).bookId
      : null;

  if (!bookId) {
    return NextResponse.json({ error: "bookId is required." }, { status: 400 });
  }

  const customerName =
    typeof body === "object" &&
    body !== null &&
    "customerName" in body &&
    typeof (body as { customerName: unknown }).customerName === "string"
      ? (body as { customerName: string }).customerName.trim()
      : "";

  const customerEmail =
    typeof body === "object" &&
    body !== null &&
    "customerEmail" in body &&
    typeof (body as { customerEmail: unknown }).customerEmail === "string"
      ? (body as { customerEmail: string }).customerEmail.trim().toLowerCase()
      : "";

  if (!customerName) {
    return NextResponse.json(
      { error: "Name is required for eBook delivery." },
      { status: 400 },
    );
  }

  if (!isValidEmail(customerEmail)) {
    return NextResponse.json(
      { error: "A valid email is required for eBook delivery." },
      { status: 400 },
    );
  }

  const book = getBookById(bookId);
  const priceId = book?.stripePriceIdEbook?.trim();
  if (priceId?.startsWith("prod_")) {
    return NextResponse.json(
      {
        error:
          "stripePriceIdEbook must be a Price ID (price_...), not a Product ID (prod_...). In Stripe: open the product → copy the Price ID under Pricing.",
      },
      { status: 400 },
    );
  }
  if (!book || !priceId) {
    return NextResponse.json(
      { error: "This eBook is not available for purchase yet." },
      { status: 400 },
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
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/#books`,
      customer_email: customerEmail,
      metadata: {
        bookId: book.id,
        customerName,
        customerEmail,
      },
    });

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
