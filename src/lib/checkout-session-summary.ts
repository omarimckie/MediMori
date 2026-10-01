import { getBookById } from "@/lib/books";
import {
  assertCatalogPhysicalShippingCents,
  isAllowedPhysicalCheckoutAmountTotalCents,
} from "@/lib/newsletter-discount-pricing";
import {
  isPhysicalCheckoutSessionMetadata,
  normalizePhysicalQuantity,
  PHYSICAL_SHIPPING_PRICE_CENTS,
} from "@/lib/physical-books";
import type Stripe from "stripe";

export type PhysicalCheckoutSessionSummary = {
  purchaseType: "physical";
  bookId: string;
  bookTitle: string;
  amountTotalCents: number;
  shippingCents: number;
  quantity: number;
  orderRecorded: boolean;
};

export type EbookCheckoutSessionSummary = {
  purchaseType: "ebook";
};

export type CheckoutSessionSummary =
  | PhysicalCheckoutSessionSummary
  | EbookCheckoutSessionSummary;

export class CheckoutSessionSummaryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;

export function isValidCheckoutSessionId(sessionId: string): boolean {
  const trimmed = sessionId.trim();
  return trimmed.length > 0 && SESSION_ID_RE.test(trimmed);
}

export function resolveCheckoutSessionSummary(
  session: Stripe.Checkout.Session,
  orderRecorded: boolean,
): CheckoutSessionSummary {
  if (!session?.id) {
    throw new CheckoutSessionSummaryError("Checkout session is missing.", 400);
  }

  if (session.payment_status !== "paid") {
    throw new CheckoutSessionSummaryError("Checkout session is not paid.", 402);
  }

  if (session.status && session.status !== "complete") {
    throw new CheckoutSessionSummaryError("Checkout session is not complete.", 402);
  }

  if (isPhysicalCheckoutSessionMetadata(session.metadata ?? undefined)) {
    const bookId = session.metadata?.bookId?.trim() ?? "";
    const book = getBookById(bookId);
    if (!book) {
      throw new CheckoutSessionSummaryError("Unknown or unsupported book.", 400);
    }

    const quantity = normalizePhysicalQuantity(session.metadata?.quantity);
    if (!quantity) {
      throw new CheckoutSessionSummaryError("Invalid physical order quantity.", 400);
    }

    const amountTotal =
      typeof session.amount_total === "number" ? session.amount_total : null;
    if (
      amountTotal === null ||
      !isAllowedPhysicalCheckoutAmountTotalCents(amountTotal, quantity)
    ) {
      throw new CheckoutSessionSummaryError(
        "Paid total does not match the catalog physical order amount.",
        400,
      );
    }

    const shippingTotal = session.total_details?.amount_shipping ?? null;
    const shippingCheck = assertCatalogPhysicalShippingCents(shippingTotal);
    if (!shippingCheck.ok) {
      throw new CheckoutSessionSummaryError(shippingCheck.error, 400);
    }
    const shippingCents =
      shippingTotal !== null ? shippingTotal : PHYSICAL_SHIPPING_PRICE_CENTS;

    return {
      purchaseType: "physical",
      bookId: book.id,
      bookTitle: book.title,
      amountTotalCents: amountTotal,
      shippingCents,
      quantity,
      orderRecorded,
    };
  }

  const bookId = session.metadata?.bookId?.trim();
  if (!bookId || !getBookById(bookId)) {
    throw new CheckoutSessionSummaryError(
      "This checkout session is missing valid book metadata.",
      400,
    );
  }

  return { purchaseType: "ebook" };
}

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
