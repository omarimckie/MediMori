import { getBookById } from "./books";
import {
  isPhysicalDirectBookId,
  PHYSICAL_SHIPPING_PRICE_CENTS,
  PHYSICAL_UNIT_PRICE_CENTS,
  physicalOrderTotalCents,
} from "./physical-books";

/** Newsletter / TWILIGHTFEATHER10 percent off eligible book line items (not shipping). */
export const NEWSLETTER_DISCOUNT_PERCENT = 10;

/** Direct-site digital checkout titles eligible for the newsletter discount. */
export const NEWSLETTER_ELIGIBLE_EBOOK_BOOK_IDS = [
  "book-one",
  "book-two",
  "book-three",
] as const;

export type NewsletterEligibleEbookBookId =
  (typeof NEWSLETTER_ELIGIBLE_EBOOK_BOOK_IDS)[number];

export function isNewsletterEligibleEbookBookId(bookId: string): boolean {
  return (NEWSLETTER_ELIGIBLE_EBOOK_BOOK_IDS as readonly string[]).includes(bookId);
}

export function isNewsletterEligiblePhysicalBookId(bookId: string): boolean {
  return isPhysicalDirectBookId(bookId);
}

export function isNewsletterEligibleDirectBook(
  bookId: string,
  purchaseType: "ebook" | "physical",
): boolean {
  if (purchaseType === "ebook") {
    return isNewsletterEligibleEbookBookId(bookId);
  }
  return isNewsletterEligiblePhysicalBookId(bookId);
}

/** Catalog eBook unit price in cents ($7.00). */
export const EBOOK_UNIT_PRICE_CENTS = 700;

export function discountedBookSubtotalCents(
  unitPriceCents: number,
  quantity: number,
  percentOff: number = NEWSLETTER_DISCOUNT_PERCENT,
): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive integer.");
  }
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error("Unit price must be a non-negative integer number of cents.");
  }
  const subtotal = unitPriceCents * quantity;
  return Math.round(subtotal * (100 - percentOff) / 100);
}

export function discountedEbookTotalCents(): number {
  return discountedBookSubtotalCents(EBOOK_UNIT_PRICE_CENTS, 1);
}

export function isNewsletterDiscountedEbookCheckoutAmount(
  amountTotalCents: number,
): boolean {
  return amountTotalCents === discountedEbookTotalCents();
}

export function isNewsletterDiscountedPhysicalCheckoutAmount(
  amountTotalCents: number,
  quantity: number,
): boolean {
  const discounted = physicalOrderTotalWithNewsletterDiscountCents(quantity);
  const full = physicalOrderTotalCents(quantity);
  return amountTotalCents === discounted && discounted !== full;
}

export function physicalOrderTotalWithNewsletterDiscountCents(quantity: number): number {
  return (
    discountedBookSubtotalCents(PHYSICAL_UNIT_PRICE_CENTS, quantity) +
    PHYSICAL_SHIPPING_PRICE_CENTS
  );
}

/** Authoritative paid totals for a direct paperback order (full price or newsletter-discounted books). */
export function allowedPhysicalCheckoutAmountTotalsCents(quantity: number): number[] {
  const full = physicalOrderTotalCents(quantity);
  const discounted = physicalOrderTotalWithNewsletterDiscountCents(quantity);
  return full === discounted ? [full] : [full, discounted];
}

export function isAllowedPhysicalCheckoutAmountTotalCents(
  amountTotalCents: number,
  quantity: number,
): boolean {
  return allowedPhysicalCheckoutAmountTotalsCents(quantity).includes(amountTotalCents);
}

export function isCatalogPhysicalShippingCents(shippingCents: number | null | undefined): boolean {
  if (shippingCents === null || shippingCents === undefined) return true;
  return shippingCents === PHYSICAL_SHIPPING_PRICE_CENTS;
}

export function assertCatalogPhysicalShippingCents(
  shippingCents: number | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (shippingCents === null || shippingCents === undefined) {
    return { ok: true };
  }
  if (shippingCents !== PHYSICAL_SHIPPING_PRICE_CENTS) {
    return {
      ok: false,
      error: "Paid shipping does not match the catalog shipping amount.",
    };
  }
  return { ok: true };
}

export function newsletterDiscountCustomerSummary(): string {
  return (
    "10% off eligible purchases made directly on this site. " +
    "Amazon purchases excluded. Paperback shipping not discounted."
  );
}

export function isNewsletterEligibleBookInCatalog(bookId: string): boolean {
  const book = getBookById(bookId);
  if (!book) return false;
  if (isNewsletterEligibleEbookBookId(bookId) && book.stripePriceIdEbook?.trim()) {
    return true;
  }
  if (isNewsletterEligiblePhysicalBookId(bookId) && book.stripePriceIdPhysical?.trim()) {
    return true;
  }
  return false;
}
