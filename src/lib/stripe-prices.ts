import type { Book } from "./books";

const TEST_PRICE_ENV: Record<string, string> = {
  "book-one": "STRIPE_TEST_PRICE_BOOK_ONE",
  "book-two": "STRIPE_TEST_PRICE_BOOK_TWO",
  "book-three": "STRIPE_TEST_PRICE_BOOK_THREE",
};

function isTestSecret(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

function testPriceFor(bookId: string): string | undefined {
  const envName = TEST_PRICE_ENV[bookId];
  if (!envName) return undefined;
  return process.env[envName]?.trim() || undefined;
}

/**
 * Price ID to send to Stripe Checkout.
 * Local sk_test_ keys use STRIPE_TEST_PRICE_BOOK_* when set.
 * Production (sk_live_) always uses books.json.
 */
export function getEbookStripePriceId(
  book: Pick<Book, "id" | "stripePriceIdEbook">,
): string | undefined {
  if (isTestSecret()) {
    const testPrice = testPriceFor(book.id);
    if (testPrice) return testPrice;
  }
  return book.stripePriceIdEbook?.trim() || undefined;
}

/** True if this paid price is valid for the book in the current Stripe mode. */
export function isAllowedEbookPrice(
  book: Pick<Book, "id" | "stripePriceIdEbook">,
  priceId: string | undefined,
): boolean {
  if (!priceId) return false;
  const live = book.stripePriceIdEbook?.trim();
  if (live && priceId === live) return true;
  const testPrice = testPriceFor(book.id);
  return Boolean(isTestSecret() && testPrice && priceId === testPrice);
}
