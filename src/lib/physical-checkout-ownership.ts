import { customerEmailFromSession, lineItemPriceId, normalizeEmail } from "./checkout-ownership";
import { getPhysicalBook, isPhysicalCheckoutSessionMetadata, normalizePhysicalQuantity, PHYSICAL_SHIPPING_PRICE_CENTS, PHYSICAL_UNIT_PRICE_CENTS, physicalOrderTotalCents } from "./physical-books";
import { isAllowedPhysicalBookPrice } from "./stripe-physical-prices";
import type { ShippingAddressSnapshot } from "./physical-orders";
import type Stripe from "stripe";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type VerifiedPhysicalCheckout = {
  bookId: string;
  quantity: number;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  amountCents: number;
  currency: string;
  stripeChargeId: string | null;
  customerName: string;
  customerEmail: string;
  shippingAddress: ShippingAddressSnapshot;
  unitPriceCents: number;
  shippingPriceCents: number;
};

export type PhysicalCheckoutEvaluation =
  | { ok: true; order: VerifiedPhysicalCheckout }
  | { ok: false; status: number; error: string };

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

type CheckoutSessionCollectedShippingDetails = NonNullable<
  Stripe.Checkout.Session["collected_information"]
>["shipping_details"];

function checkoutSessionShippingDetails(
  session: Stripe.Checkout.Session,
): CheckoutSessionCollectedShippingDetails {
  return session.collected_information?.shipping_details ?? null;
}

export function shippingAddressFromSession(
  session: Stripe.Checkout.Session,
): ShippingAddressSnapshot | null {
  const shipping = checkoutSessionShippingDetails(session);
  const address = shipping?.address ?? session.customer_details?.address;
  if (!address?.line1?.trim()) return null;

  return {
    name: shipping?.name?.trim() || session.customer_details?.name?.trim() || null,
    line1: address.line1?.trim() || null,
    line2: address.line2?.trim() || null,
    city: address.city?.trim() || null,
    state: address.state?.trim() || null,
    postalCode: address.postal_code?.trim() || null,
    country: address.country?.trim() || null,
  };
}

export function isPhysicalCheckoutSession(session: Stripe.Checkout.Session): boolean {
  return isPhysicalCheckoutSessionMetadata(session.metadata ?? undefined);
}

export function evaluatePaidPhysicalCheckout(
  session: Stripe.Checkout.Session,
): PhysicalCheckoutEvaluation {
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

  if (!isPhysicalCheckoutSession(session)) {
    return {
      ok: false,
      status: 400,
      error: "Checkout session is not a physical purchase.",
    };
  }

  const bookId = session.metadata?.bookId?.trim() ?? "";
  const book = getPhysicalBook(bookId);
  if (!book) {
    return {
      ok: false,
      status: 400,
      error: "Unknown or unsupported physical book.",
    };
  }

  const quantity = normalizePhysicalQuantity(session.metadata?.quantity);
  if (!quantity) {
    return {
      ok: false,
      status: 400,
      error: "Invalid physical order quantity.",
    };
  }

  const items = session.line_items?.data ?? [];
  const bookLineItems = items.filter((item) =>
    isAllowedPhysicalBookPrice(book, lineItemPriceId(item)),
  );
  if (bookLineItems.length !== 1) {
    return {
      ok: false,
      status: 400,
      error: "Physical checkout must include exactly one catalog book line item.",
    };
  }

  const bookLine = bookLineItems[0]!;
  const paidBookQty = bookLine.quantity ?? 0;
  if (paidBookQty !== quantity) {
    return {
      ok: false,
      status: 400,
      error: "Paid book quantity does not match order metadata.",
    };
  }

  const expectedTotal = physicalOrderTotalCents(quantity);
  const amountTotal =
    typeof session.amount_total === "number" ? session.amount_total : null;
  if (amountTotal === null || amountTotal !== expectedTotal) {
    return {
      ok: false,
      status: 400,
      error: "Paid total does not match the catalog physical order amount.",
    };
  }

  const shippingTotal = session.total_details?.amount_shipping ?? null;
  if (shippingTotal !== null && shippingTotal !== PHYSICAL_SHIPPING_PRICE_CENTS) {
    return {
      ok: false,
      status: 400,
      error: "Paid shipping does not match the catalog shipping amount.",
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

  const shippingDetails = checkoutSessionShippingDetails(session);
  const customerName =
    session.metadata?.customerName?.trim() ||
    session.customer_details?.name?.trim() ||
    shippingDetails?.name?.trim() ||
    "";
  if (!customerName) {
    return {
      ok: false,
      status: 400,
      error: "Checkout session is missing customer name.",
    };
  }

  const shippingAddress = shippingAddressFromSession(session);
  if (!shippingAddress) {
    return {
      ok: false,
      status: 400,
      error: "Checkout session is missing a shipping address.",
    };
  }

  if (shippingAddress.country && shippingAddress.country !== "US") {
    return {
      ok: false,
      status: 400,
      error: "Physical orders must ship to the United States.",
    };
  }

  return {
    ok: true,
    order: {
      bookId: book.id,
      quantity,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId(session.payment_intent),
      amountCents: amountTotal,
      currency: session.currency?.trim() || "usd",
      stripeChargeId: chargeIdFromSession(session),
      customerName,
      customerEmail: normalizeEmail(email),
      shippingAddress,
      unitPriceCents: PHYSICAL_UNIT_PRICE_CENTS,
      shippingPriceCents: PHYSICAL_SHIPPING_PRICE_CENTS,
    },
  };
}
