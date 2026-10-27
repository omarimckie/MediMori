import type { Book } from "./books";
import { getBookById } from "./books";

/** Paperback titles fulfilled from Twilight Feather inventory. */
export const PHYSICAL_DIRECT_BOOK_IDS = ["book-one", "book-three"] as const;

export type PhysicalDirectBookId = (typeof PHYSICAL_DIRECT_BOOK_IDS)[number];

export const PHYSICAL_UNIT_PRICE_CENTS = 1000;
export const PHYSICAL_SHIPPING_PRICE_CENTS = 499;

export const PHYSICAL_PURCHASE_TYPE = "physical";

export function isPhysicalCheckoutSessionMetadata(
  metadata: Record<string, string> | null | undefined,
): boolean {
  return metadata?.purchaseType?.trim() === PHYSICAL_PURCHASE_TYPE;
}

export function isPhysicalDirectBookId(bookId: string): bookId is PhysicalDirectBookId {
  return (PHYSICAL_DIRECT_BOOK_IDS as readonly string[]).includes(bookId);
}

export function physicalOrderTotalCents(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive integer.");
  }
  return PHYSICAL_UNIT_PRICE_CENTS * quantity + PHYSICAL_SHIPPING_PRICE_CENTS;
}

export function normalizePhysicalQuantity(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 99) return null;
  return num;
}

export function getPhysicalBook(bookId: string): Book | undefined {
  if (!isPhysicalDirectBookId(bookId)) return undefined;
  return getBookById(bookId);
}
