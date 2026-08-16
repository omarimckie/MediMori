import { getBookById } from "./books";
import { isAllowedEbookPrice } from "./stripe-prices";
import type Stripe from "stripe";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type VerifiedCheckoutPurchase = {
  email: string;
  bookId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
  stripeChargeId: string | null;
};

export type CheckoutOwnershipResult =
  | { ok: true; purchase: VerifiedCheckoutPurchase }
  | { ok: false; status: number; error: string };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function lineItemPriceId(item: Stripe.LineItem): string | undefined {
  const price = item.price;
  if (!price) return undefined;
  if (typeof price === "string") return price;
  return price.id;
}

function paymentIntentId(
  paymentIntent: Stripe.Checkout.Session["payment_intent"],
): string | null {
  if (!paymentIntent) return null;
  if (typeof paymentIntent === "string") return paymentIntent;
  return paymentIntent.id ?? null;
}

function chargeIdFromSession(session: Stripe.Checkout.Session): string | null {
  const paymentIntent = session.payment_intent;
  if (!paymentIntent || typeof paymentIntent === "string") return null;
  const charge = paymentIntent.latest_charge;
  if (!charge) return null;
  if (typeof charge === "string") return charge;
  return charge.id ?? null;
}

function customerEmailFromSession(session: Stripe.Checkout.Session): string {
  const fromDetails = session.customer_details?.email?.trim() ?? "";
  const fromSession = session.customer_email?.trim() ?? "";
  const fromMetadata = session.metadata?.customerEmail?.trim() ?? "";
  return normalizeEmail(fromDetails || fromSession || fromMetadata);
}

/**
 * Validates a Stripe Checkout Session for permanent ownership recording.
 * Does not write to the database. Does not inspect card or billing fields
 * for storage — only email, book metadata, payment status, and price ID.
 */
export function evaluatePaidCheckout(
  session: Stripe.Checkout.Session,
): CheckoutOwnershipResult {
  if (!session?.id) {
    return { ok: false, status: 400, error: "Checkout session is missing." };
  }

  if (session.payment_status !== "paid") {
    return {
      ok: false,
      status: 402,
      error: "Checkout session is not paid.",
    };
  }

  const bookId = session.metadata?.bookId?.trim() ?? "";
  if (!bookId) {
    return {
      ok: false,
      status: 400,
      error: "Checkout session is missing book metadata.",
    };
  }

  const book = getBookById(bookId);
  if (!book || !book.stripePriceIdEbook?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "Unknown or unpurchasable book.",
    };
  }

  const items = session.line_items?.data ?? [];
  if (items.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Checkout session has no line items.",
    };
  }

  const paidWithCatalogPrice = items.some((item) =>
    isAllowedEbookPrice(book, lineItemPriceId(item)),
  );
  if (!paidWithCatalogPrice) {
    return {
      ok: false,
      status: 400,
      error: "Paid price does not match the catalog eBook price.",
    };
  }

  const email = customerEmailFromSession(session);
  if (!email || !EMAIL_RE.test(email)) {
    return {
      ok: false,
      status: 400,
      error: "Checkout session is missing a usable customer email.",
    };
  }

  return {
    ok: true,
    purchase: {
      email,
      bookId: book.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId(session.payment_intent),
      amountCents:
        typeof session.amount_total === "number" ? session.amount_total : null,
      currency: session.currency?.trim() || null,
      stripeChargeId: chargeIdFromSession(session),
    },
  };
}
