import { getBookById } from "@/lib/books";
import { lineItemPriceId } from "@/lib/checkout-ownership";
import { isAllowedEbookPrice } from "@/lib/stripe-prices";
import type Stripe from "stripe";

export type DigitalPurchaseLine = {
  bookId: string;
  title: string;
  quantity: number;
  unitAmountCents: number | null;
  lineAmountCents: number | null;
};

function lineQuantity(quantity: number | null | undefined): number {
  if (!quantity || !Number.isInteger(quantity) || quantity < 1) return 1;
  return quantity;
}

function unitAmountCents(item: Stripe.LineItem): number | null {
  const price = item.price;
  if (!price || typeof price === "string") return null;
  return typeof price.unit_amount === "number" ? price.unit_amount : null;
}

/**
 * One stored row per catalog book on a paid ebook Checkout Session.
 * Quantities on matching line items are summed.
 */
export function itemizedDigitalLinesFromSession(
  session: Stripe.Checkout.Session,
  bookId: string,
): DigitalPurchaseLine[] {
  const book = getBookById(bookId);
  if (!book) return [];

  const items = session.line_items?.data ?? [];
  const matching = items.filter((item) =>
    isAllowedEbookPrice(book, lineItemPriceId(item)),
  );
  if (!matching.length) return [];

  let quantity = 0;
  let lineAmountCents = 0;
  let sawAmount = false;
  let unit: number | null = null;

  for (const item of matching) {
    const qty = lineQuantity(item.quantity);
    quantity += qty;
    const amount = item.amount_subtotal ?? item.amount_total ?? null;
    if (typeof amount === "number") {
      lineAmountCents += amount;
      sawAmount = true;
    }
    if (unit == null) unit = unitAmountCents(item);
  }

  return [
    {
      bookId: book.id,
      title: book.title,
      quantity: quantity > 0 ? quantity : 1,
      unitAmountCents: unit,
      lineAmountCents: sawAmount ? lineAmountCents : null,
    },
  ];
}

export async function persistItemizedDigitalPurchase(
  lines: DigitalPurchaseLine[],
  recordItems: (lines: DigitalPurchaseLine[]) => Promise<void>,
): Promise<void> {
  if (!lines.length) {
    throw new Error("Digital purchase has no itemized lines.");
  }
  await recordItems(lines);
}

/** Mirrors INSERT ... ON CONFLICT DO NOTHING for a purchase's item rows. */
export function keepFirstDigitalLines(
  existing: DigitalPurchaseLine[],
  incoming: DigitalPurchaseLine[],
): DigitalPurchaseLine[] {
  const rows = new Map(existing.map((line) => [line.bookId, line]));
  for (const line of incoming) {
    if (!rows.has(line.bookId)) rows.set(line.bookId, line);
  }
  return [...rows.values()];
}
