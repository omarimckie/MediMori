import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type Stripe from "stripe";
import { evaluatePaidCheckout } from "./checkout-ownership";
import { evaluatePaidPhysicalCheckout } from "./physical-checkout-ownership";
import { physicalOrderTotalCents } from "./physical-books";
import { buildPhysicalCheckoutSessionCreateParams } from "./physical-checkout-session";
import {
  analyzePaidCheckoutSessionNewsletterDiscount,
  claimNewsletterPromotionRedemption,
  validateRedemptionEmail,
} from "./newsletter-promotion-redemption";

const TEST_PHYSICAL_ONE = "price_test_physical_book_one";
const TEST_NEWSLETTER_COUPON_ID = "coupon_test_newsletter";

function expandedNewsletterPromotionCode(
  promotionCodeId: string,
  couponId = TEST_NEWSLETTER_COUPON_ID,
  code = "TWILIGHTFEATHER10",
): Stripe.PromotionCode {
  return {
    id: promotionCodeId,
    object: "promotion_code",
    code,
    active: true,
    promotion: { type: "coupon", coupon: couponId },
  } as Stripe.PromotionCode;
}

function sessionWithNewsletterPromo(
  session: Stripe.Checkout.Session,
  promotionCodeId = "promo_test_global_twilight",
  couponId = TEST_NEWSLETTER_COUPON_ID,
  code = "TWILIGHTFEATHER10",
): Stripe.Checkout.Session {
  return {
    ...session,
    discounts: [
      {
        promotion_code: expandedNewsletterPromotionCode(
          promotionCodeId,
          couponId,
          code,
        ),
      },
    ],
  } as Stripe.Checkout.Session;
}

function physicalSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  const quantity = overrides.metadata?.quantity
    ? Number(overrides.metadata.quantity)
    : 1;
  const total =
    typeof overrides.amount_total === "number"
      ? overrides.amount_total
      : physicalOrderTotalCents(quantity);
  return {
    id: overrides.id ?? "cs_test_physical",
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    amount_total: total,
    currency: "usd",
    metadata: {
      purchaseType: "physical",
      bookId: "book-one",
      quantity: String(quantity),
      customerEmail: "buyer@example.com",
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
      amount_discount: 0,
      ...overrides.total_details,
    },
    payment_intent: "pi_test_physical",
    ...overrides,
  } as Stripe.Checkout.Session;
}

function ebookSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: overrides.id ?? "cs_test_ebook",
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
    total_details: {
      amount_discount: 70,
      amount_shipping: 0,
      amount_tax: 0,
      ...overrides.total_details,
    },
    payment_intent: "pi_test_ebook",
    ...overrides,
  } as Stripe.Checkout.Session;
}

test("validateRedemptionEmail normalizes casing", () => {
  const result = validateRedemptionEmail("  Reader@Example.COM ");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.email, "reader@example.com");
  }
  assert.equal(validateRedemptionEmail("not-an-email").ok, false);
});

test("analyzePaidCheckoutSessionNewsletterDiscount — full price is not redemption", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    ebookSession({
      amount_total: 700,
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    }),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "not_newsletter_discount");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — discounted ebook without TWILIGHT promo is not redemption", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    ebookSession(),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "not_newsletter_discount");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — discounted ebook qualifies with TWILIGHT promo", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(ebookSession()),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "newsletter_redemption");
  if (analysis.status === "newsletter_redemption") {
    assert.equal(analysis.email, "reader@example.com");
  }
});

test("analyzePaidCheckoutSessionNewsletterDiscount — two promo ids with same code and coupon qualify", () => {
  const global = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(ebookSession(), "promo_global"),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  const customer = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(ebookSession(), "promo_customer_restricted"),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(global.status, "newsletter_redemption");
  assert.equal(customer.status, "newsletter_redemption");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — HOLIDAY2026 does not count as newsletter", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(
      ebookSession(),
      "promo_holiday_2026",
      TEST_NEWSLETTER_COUPON_ID,
      "HOLIDAY2026",
    ),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "not_newsletter_discount");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — TWILIGHTFEATHER10 with wrong coupon is not newsletter", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(
      ebookSession(),
      "promo_wrong_coupon",
      "coupon_other_10_percent",
      "TWILIGHTFEATHER10",
    ),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "not_newsletter_discount");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — TWILIGHT promo with invalid ebook total is rejected", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(
      ebookSession({ amount_total: 500, total_details: { amount_discount: 200, amount_shipping: 0, amount_tax: 0 } }),
    ),
    { purchaseType: "ebook", bookId: "book-one" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "invalid");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — eligible physical qty 1", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(
      physicalSession({
        amount_total: 1399,
        total_details: { amount_shipping: 499, amount_discount: 100, amount_tax: 0 },
      }),
    ),
    { purchaseType: "physical", bookId: "book-one", quantity: 1 },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "newsletter_redemption");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — full physical total is not redemption", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    physicalSession({
      amount_total: 1499,
      total_details: { amount_shipping: 499, amount_discount: 0, amount_tax: 0 },
    }),
    { purchaseType: "physical", bookId: "book-one", quantity: 1 },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "not_newsletter_discount");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — book-two digital eligible", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(
      ebookSession({
        metadata: { bookId: "book-two", customerEmail: "a@b.com", customerName: "A" },
        customer_email: "a@b.com",
      }),
    ),
    { purchaseType: "ebook", bookId: "book-two" },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "newsletter_redemption");
});

test("analyzePaidCheckoutSessionNewsletterDiscount — book-two physical ineligible", () => {
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    sessionWithNewsletterPromo(
      physicalSession({
        metadata: {
          purchaseType: "physical",
          bookId: "book-two",
          quantity: "1",
          customerEmail: "buyer@example.com",
        },
        amount_total: 1399,
        total_details: { amount_shipping: 499, amount_discount: 100, amount_tax: 0 },
      }),
    ),
    { purchaseType: "physical", bookId: "book-two", quantity: 1 },
    TEST_NEWSLETTER_COUPON_ID,
  );
  assert.equal(analysis.status, "invalid");
});

test("evaluatePaidCheckout and evaluatePaidPhysicalCheckout still accept newsletter totals", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;
  assert.equal(evaluatePaidCheckout(ebookSession()).ok, true);
  assert.equal(
    evaluatePaidPhysicalCheckout(
      physicalSession({
        amount_total: 1399,
        total_details: { amount_shipping: 499, amount_discount: 100, amount_tax: 0 },
      }),
    ).ok,
    true,
  );
  assert.equal(
    evaluatePaidPhysicalCheckout(
      physicalSession({
        amount_total: 1499,
        total_details: { amount_shipping: 499, amount_discount: 0, amount_tax: 0 },
      }),
    ).ok,
    true,
  );
});

test("physical checkout session always enables promotion codes", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_TEST_PRICE_PHYSICAL_BOOK_ONE = TEST_PHYSICAL_ONE;
  const params = buildPhysicalCheckoutSessionCreateParams({
    bookId: "book-one",
    quantity: 1,
    priceId: TEST_PHYSICAL_ONE,
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    customerEmail: "Buyer@Example.com",
    stripeCustomerId: "cus_test",
  });
  assert.equal(params.customer, "cus_test");
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.metadata?.customerEmail, "buyer@example.com");
});

test("checkout routes always allow promotion codes regardless of prior redemption", () => {
  const ebookRoute = readFileSync(
    new URL("../app/api/checkout/route.ts", import.meta.url),
    "utf8",
  );
  const physicalRoute = readFileSync(
    new URL("../app/api/checkout/physical/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(ebookRoute, /hasRedeemedNewsletterPromotion/);
  assert.match(ebookRoute, /allow_promotion_codes:\s*true/);
  assert.match(physicalRoute, /customerEmail/);
  const physicalSessionBuilder = readFileSync(
    new URL("../lib/physical-checkout-session.ts", import.meta.url),
    "utf8",
  );
  assert.match(physicalSessionBuilder, /allow_promotion_codes:\s*true/);
});

test("webhook claims newsletter redemption before fulfillment", () => {
  const webhook = readFileSync(
    new URL("../app/api/webhooks/stripe/route.ts", import.meta.url),
    "utf8",
  );
  const physicalIdx = webhook.indexOf("evaluatePaidPhysicalCheckout(session)");
  const physicalGate = webhook.indexOf(
    "const newsletterGate = await ensurePaidNewsletterRedemptionBeforeFulfillment",
    physicalIdx,
  );
  const physicalFulfill = webhook.indexOf("fulfillPhysicalOrder", physicalIdx);
  assert.ok(physicalIdx < physicalGate && physicalGate < physicalFulfill);

  const ebookEval = webhook.indexOf("evaluatePaidCheckout(session)");
  const ebookGate = webhook.indexOf(
    "const newsletterGate = await ensurePaidNewsletterRedemptionBeforeFulfillment",
    ebookEval,
  );
  const recordPurchase = webhook.indexOf("recordPurchaseAndEntitlement", ebookEval);
  assert.ok(ebookEval < ebookGate && ebookGate < recordPurchase);
});

test("physical checkout form collects email", () => {
  const form = readFileSync(
    new URL("../components/PhysicalCheckoutForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(form, /customerEmail/);
  assert.match(form, /type="email"/);
});

test(
  "newsletter_promotion_redemptions database (NEWSLETTER_REDEMPTION_TEST_DATABASE_URL)",
  { skip: !process.env.NEWSLETTER_REDEMPTION_TEST_DATABASE_URL?.trim() },
  async () => {
    process.env.DATABASE_URL =
      process.env.NEWSLETTER_REDEMPTION_TEST_DATABASE_URL!.trim();

    const unique = `redemption-test-${Date.now()}@example.com`;
    const sessionA = `cs_test_${Date.now()}_a`;
    const sessionB = `cs_test_${Date.now()}_b`;

    const first = await claimNewsletterPromotionRedemption(unique, sessionA);
    assert.equal(first.status, "claimed");

    const second = await claimNewsletterPromotionRedemption(unique, sessionB);
    assert.equal(second.status, "already_redeemed");

    const idempotent = await claimNewsletterPromotionRedemption(unique, sessionA);
    assert.equal(idempotent.status, "idempotent");

    const otherEmail = `other-${Date.now()}@example.com`;
    const other = await claimNewsletterPromotionRedemption(otherEmail, `cs_other_${Date.now()}`);
    assert.equal(other.status, "claimed");

    const normalized = await claimNewsletterPromotionRedemption(
      unique.toUpperCase(),
      `cs_should_fail_${Date.now()}`,
    );
    assert.equal(normalized.status, "already_redeemed");

    const raceEmail = `race-${Date.now()}@example.com`;
    const raceStamp = Date.now();
    const [claimA, claimB] = await Promise.all([
      claimNewsletterPromotionRedemption(raceEmail, `cs_race_a_${raceStamp}`),
      claimNewsletterPromotionRedemption(raceEmail, `cs_race_b_${raceStamp}`),
    ]);
    const winners = [claimA, claimB].filter((r) => r.status === "claimed");
    assert.equal(winners.length, 1);
  },
);
