import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getBookById } from "@/lib/books";
import {
  bookProductJsonLd,
  bookSeoDescription,
  ebookPriceAmount,
  SITE_NAME,
} from "./seo";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function offerPrices(jsonLd: ReturnType<typeof bookProductJsonLd>): string[] {
  const offers = jsonLd.offers;
  assert.ok(offers, "expected offers on Product JSON-LD");
  const list = Array.isArray(offers) ? offers : [offers];
  return list.map((offer) => String(offer.price));
}

function allOfferUrls(jsonLd: ReturnType<typeof bookProductJsonLd>): string[] {
  const offers = jsonLd.offers;
  if (!offers) return [];
  const list = Array.isArray(offers) ? offers : [offers];
  return list.map((offer) => String(offer.url));
}

test("book-one JSON-LD has two site offers at 7.00 and 10.00", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  const book = getBookById("book-one");
  assert.ok(book);
  const jsonLd = bookProductJsonLd(book);
  assert.deepEqual(offerPrices(jsonLd), ["7.00", "10.00"]);
});

test("book-two JSON-LD has one ebook offer at 7.00", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  const book = getBookById("book-two");
  assert.ok(book);
  const jsonLd = bookProductJsonLd(book);
  assert.deepEqual(offerPrices(jsonLd), ["7.00"]);
});

test("book-three JSON-LD has two site offers at 7.00 and 10.00", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  const book = getBookById("book-three");
  assert.ok(book);
  const jsonLd = bookProductJsonLd(book);
  assert.deepEqual(offerPrices(jsonLd), ["7.00", "10.00"]);
});

test("book Product JSON-LD offers do not use amazon.com URLs", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  for (const id of ["book-one", "book-two", "book-three"] as const) {
    const book = getBookById(id);
    assert.ok(book);
    const jsonLd = bookProductJsonLd(book);
    const serialized = JSON.stringify(jsonLd);
    assert.equal(serialized.includes("amazon.com"), false);
    for (const url of allOfferUrls(jsonLd)) {
      assert.equal(url.includes("amazon.com"), false);
    }
  }
});

test("book JSON-LD offers include Twilight Feather seller", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  const book = getBookById("book-one");
  assert.ok(book);
  const offers = bookProductJsonLd(book).offers;
  assert.ok(Array.isArray(offers));
  for (const offer of offers) {
    assert.equal(offer.seller?.["@type"], "Organization");
    assert.equal(offer.seller?.name, SITE_NAME);
  }
});

test("bookSeoDescription reflects multi-product positioning", () => {
  const one = getBookById("book-one");
  const two = getBookById("book-two");
  const three = getBookById("book-three");
  assert.ok(one && two && three);

  assert.match(bookSeoDescription(one), /Paperback \$10 \+ \$4\.99 shipping/);
  assert.match(bookSeoDescription(one), /read-online eBook/);
  assert.match(bookSeoDescription(one), /Amazon/);

  assert.match(bookSeoDescription(two), /PDF download/);
  assert.match(bookSeoDescription(two), /Amazon/);
  assert.doesNotMatch(bookSeoDescription(two), /\b60\b/);

  assert.match(bookSeoDescription(three), /AJ Can Breathe Easy/);
  assert.match(bookSeoDescription(three), /Paperback \$10 \+ \$4\.99 shipping/);
});

test("ebookPriceAmount parsing is preserved", () => {
  assert.equal(ebookPriceAmount("$7.00"), "7.00");
  assert.equal(ebookPriceAmount("7"), "7.00");
  assert.equal(ebookPriceAmount("$1,234.50"), "1234.50");
  assert.equal(ebookPriceAmount(undefined), null);
  assert.equal(ebookPriceAmount("   "), null);
  assert.equal(ebookPriceAmount("no price"), null);
});
