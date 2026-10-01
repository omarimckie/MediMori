import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluatePaidCheckout } from "./checkout-ownership";
import { resolveCheckoutSessionSummary } from "./checkout-session-summary";
import {
  allowedPhysicalCheckoutAmountTotalsCents,
  assertCatalogPhysicalShippingCents,
  discountedEbookTotalCents,
  isAllowedPhysicalCheckoutAmountTotalCents,
  isNewsletterEligibleEbookBookId,
  isNewsletterEligiblePhysicalBookId,
  physicalOrderTotalWithNewsletterDiscountCents,
} from "./newsletter-discount-pricing";
import { evaluatePaidPhysicalCheckout } from "./physical-checkout-ownership";
import { physicalOrderTotalCents } from "./physical-books";
import { buildPhysicalCheckoutSessionCreateParams } from "./physical-checkout-session";
import type Stripe from "stripe";

const TEST_PHYSICAL_ONE = "price_test_physical_book_one";

function physicalSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  const quantity = overrides.metadata?.quantity
    ? Number(overrides.metadata.quantity)
    : 1;
  const total =
    typeof overrides.amount_total === "number"
      ? overrides.amount_total
      : physicalOrderTotalCents(quantity);
  return {
    id: "cs_test_physical",
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    amount_total: total,
    currency: "usd",
    metadata: {
      purchaseType: "physical",
      bookId: "book-one",
      quantity: String(quantity),
      ...overrides.metadata,
    },
    customer_details: {
      email: "buyer@example.com",
      name: "Buyer Name",
    },
    collected_information: {
      business_name: null,
      individual_name: null,
      shipping_details: {
        name: "Buyer Name",
        address: {
          line1: "123 Main St",
          line2: null,
          city: "Miami",
          state: "FL",
          postal_code: "33101",
          country: "US",
        },
      },
    },
    line_items: {
      object: "list",
      data: [
        {
          id: "li_test",
          object: "item",
          quantity,
          price: { id: TEST_PHYSICAL_ONE, object: "price" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
    total_details: {
      amount_shipping: 499,
    },
    payment_intent: "pi_test_physical",
    ...overrides,
  } as Stripe.Checkout.Session;
}

function ebookSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_ebook",
    object: "checkout.session",
    payment_status: "paid",
    amount_total: 630,
    currency: "usd",
    metadata: {
      bookId: "book-one",
      customerName: "Reader",
      customerEmail: "reader@example.com",
    },
    customer_email: "reader@example.com",
    line_items: {
      object: "list",
      data: [
        {
          id: "li_ebook",
          object: "item",
          quantity: 1,
          price: { id: "price_1TMhTEGmFetwj9NcJnvrh1e2", object: "price" },
        } as Stripe.LineItem,
      ],
      has_more: false,
      url: "",
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

test("eligibility: sickle cell, asthma, and word search digital are eligible", () => {
  assert.equal(isNewsletterEligibleEbookBookId("book-one"), true);
  assert.equal(isNewsletterEligibleEbookBookId("book-three"), true);
  assert.equal(isNewsletterEligibleEbookBookId("book-two"), true);
});

test("eligibility: sickle cell and asthma direct paperback are eligible", () => {
  assert.equal(isNewsletterEligiblePhysicalBookId("book-one"), true);
  assert.equal(isNewsletterEligiblePhysicalBookId("book-three"), true);
  assert.equal(isNewsletterEligiblePhysicalBookId("book-two"), false);
});

test("ebook discounted total is $6.30", () => {
  assert.equal(discountedEbookTotalCents(), 630);
});

test("physical qty 1 allows full $14.99 and discounted $13.99 totals", () => {
  assert.deepEqual(allowedPhysicalCheckoutAmountTotalsCents(1), [1499, 1399]);
  assert.equal(isAllowedPhysicalCheckoutAmountTotalCents(1499, 1), true);
  assert.equal(isAllowedPhysicalCheckoutAmountTotalCents(1399, 1), true);
  assert.equal(isAllowedPhysicalCheckoutAmountTotalCents(1349, 1), false);
});

test("physical qty 2 discounted book subtotal plus $4.99 shipping", () => {
  assert.equal(physicalOrderTotalWithNewsletterDiscountCents(2), 2299);
  assert.equal(isAllowedPhysicalCheckoutAmountTotalCents(2299, 2), true);
});

test("evaluatePaidPhysicalCheckout accepts full price and newsletter discount with $4.99 shipping", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;

  const full = evaluatePaidPhysicalCheckout(physicalSession({ amount_total: 1499 }));
  assert.equal(full.ok, true);

  const discounted = evaluatePaidPhysicalCheckout(
    physicalSession({ amount_total: 1399 }),
  );
  assert.equal(discounted.ok, true);
});

test("evaluatePaidPhysicalCheckout rejects arbitrary totals and bad shipping", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;

  assert.equal(evaluatePaidPhysicalCheckout(physicalSession({ amount_total: 1000 })).ok, false);
  assert.equal(
    evaluatePaidPhysicalCheckout(
      physicalSession({
        total_details: { amount_shipping: 449 } as NonNullable<
          Stripe.Checkout.Session["total_details"]
        >,
      }),
    ).ok,
    false,
  );
  assert.equal(
    evaluatePaidPhysicalCheckout(
      physicalSession({
        total_details: { amount_shipping: 549 } as NonNullable<
          Stripe.Checkout.Session["total_details"]
        >,
      }),
    ).ok,
    false,
  );
});

test("evaluatePaidPhysicalCheckout rejects arbitrary physical price id", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;

  const bad = evaluatePaidPhysicalCheckout(
    physicalSession({
      line_items: {
        object: "list",
        data: [
          {
            id: "li_bad",
            object: "item",
            quantity: 1,
            price: { id: "price_wrong", object: "price" },
          } as Stripe.LineItem,
        ],
        has_more: false,
        url: "",
      },
    }),
  );
  assert.equal(bad.ok, false);
});

test("evaluatePaidCheckout accepts $6.30 ebook with catalog price id", () => {
  const result = evaluatePaidCheckout(ebookSession());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.purchase.amountCents, 630);
  }
});

test("resolveCheckoutSessionSummary accepts discounted physical total", () => {
  const summary = resolveCheckoutSessionSummary(
    physicalSession({ amount_total: 1399 }),
    false,
  );
  assert.equal(summary.purchaseType, "physical");
  if (summary.purchaseType === "physical") {
    assert.equal(summary.amountTotalCents, 1399);
    assert.equal(summary.shippingCents, 499);
  }
});

test("assertCatalogPhysicalShippingCents requires exactly $4.99 when present", () => {
  assert.equal(assertCatalogPhysicalShippingCents(499).ok, true);
  assert.equal(assertCatalogPhysicalShippingCents(null).ok, true);
  assert.equal(assertCatalogPhysicalShippingCents(449).ok, false);
});

test("physical checkout session enables promotion codes", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;
  const params = buildPhysicalCheckoutSessionCreateParams({
    bookId: "book-one",
    quantity: 1,
    priceId: TEST_PHYSICAL_ONE,
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    customerEmail: "buyer@example.com",
    allowPromotionCodes: true,
  });
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.metadata?.customerEmail, "buyer@example.com");
});

test("physical checkout route uses newsletter promotion helper", () => {
  const source = readFileSync(
    new URL("../app/api/checkout/physical/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /ensureNewsletterPromotionCode/);
});

test("customer copy is no longer eBook-only on homepage and ebook checkout", () => {
  const signup = readFileSync(
    new URL("../components/EmailSignup.tsx", import.meta.url),
    "utf8",
  );
  const ebook = readFileSync(
    new URL("../components/EbookCheckoutForm.tsx", import.meta.url),
    "utf8",
  );
  const email = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
  assert.match(signup, /first book purchase/);
  assert.doesNotMatch(signup, /eBook purchases only/i);
  assert.doesNotMatch(ebook, /10% off eBook purchases/i);
  assert.doesNotMatch(email, /buy an eBook on our website/i);
});

test("marketing safety no longer requires eBook-only discount wording", () => {
  const safety = readFileSync(
    new URL("./marketing/safety.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(safety, /eBook-only/i);
});
