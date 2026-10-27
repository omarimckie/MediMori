import type { Book } from "./books";
import type { PhysicalDirectBookId } from "./physical-books";
import { isPhysicalDirectBookId } from "./physical-books";

const TEST_PHYSICAL_PRICE_ENV: Record<PhysicalDirectBookId, string> = {
  "book-one": "STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE",
  "book-three": "STRIPE_TEST_PRICE_PHYSICAL_BOOK_THREE",
};

function isTestSecret(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

function testPhysicalPriceFor(bookId: PhysicalDirectBookId): string | undefined {
  const envName = TEST_PHYSICAL_PRICE_ENV[bookId];
  return process.env[envName]?.trim() || undefined;
}

/**
 * Stripe Price ID for a $10 paperback (physical direct).
 * Local sk_test_ keys use STRIPE_TEST_PRICE_PHYSICAL_BOOK_* when set.
 * Production (sk_live_) uses stripePriceIdPhysical from books.json.
 */
export function getPhysicalStripePriceId(
  book: Pick<Book, "id" | "stripePriceIdPhysical">,
): string | undefined {
  if (!isPhysicalDirectBookId(book.id)) return undefined;
  if (isTestSecret()) {
    const testPrice = testPhysicalPriceFor(book.id);
    if (testPrice) return testPrice;
  }
  return book.stripePriceIdPhysical?.trim() || undefined;
}

export function isAllowedPhysicalBookPrice(
  book: Pick<Book, "id" | "stripePriceIdPhysical">,
  priceId: string | undefined,
): boolean {
  if (!priceId || !isPhysicalDirectBookId(book.id)) return false;
  const live = book.stripePriceIdPhysical?.trim();
  if (live && priceId === live) return true;
  const testPrice = testPhysicalPriceFor(book.id);
  return Boolean(isTestSecret() && testPrice && priceId === testPrice);
}
