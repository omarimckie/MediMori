import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, afterEach } from "node:test";
import type Stripe from "stripe";
import {
  __setNewsletterStripeCouponIdForTests,
} from "./stripe-discount";
import {
  buildCustomerSpecificPromotionCodeCreateParams,
  getNewsletterPromotionIssuanceByEmail,
  issueCustomerSpecificNewsletterPromotion,
  attemptNewsletterPromotionIssuanceAfterSignup,
  recordNewsletterPromotionIssuance,
  type NewsletterPromotionIssuanceRow,
} from "./newsletter-promotion-issuance";
import { getNewsletterDiscountCode } from "./newsletter-constants";
import { isNewsletterCouponPromotionApplication } from "./stripe-discount";

const COUPON = "coupon_newsletter_phase2";

afterEach(() => {
  __setNewsletterStripeCouponIdForTests(undefined);
});

function mockStripe(handlers: {
  listPromotions?: (
    params: Stripe.PromotionCodeListParams,
  ) => Promise<{ data: Stripe.PromotionCode[] }>;
  createPromotion?: (
    params: Stripe.PromotionCodeCreateParams,
  ) => Promise<Stripe.PromotionCode>;
  stripeCustomerId?: string;
}): Stripe {
  const customerId = handlers.stripeCustomerId ?? "cus_default";
  return {
    customers: {
      search: async () => ({ data: [] }),
      create: async () => ({ id: customerId }),
    },
    promotionCodes: {
      list: async (params: Stripe.PromotionCodeListParams) =>
        handlers.listPromotions?.(params) ?? { data: [] },
      create: async (params: Stripe.PromotionCodeCreateParams) => {
        if (!handlers.createPromotion) {
          throw new Error("create not expected");
        }
        return handlers.createPromotion(params);
      },
    },
  } as unknown as Stripe;
}

test("buildCustomerSpecificPromotionCodeCreateParams matches Option B shape", () => {
  const params = buildCustomerSpecificPromotionCodeCreateParams(
    "cus_test_abc",
    COUPON,
  );
  assert.deepEqual(params.promotion, { type: "coupon", coupon: COUPON });
  assert.equal(params.code, getNewsletterDiscountCode());
  assert.equal(params.customer, "cus_test_abc");
  assert.equal(params.max_redemptions, 1);
  assert.equal(params.active, true);
  assert.equal(params.metadata?.scope, "customer");
  assert.equal(params.metadata?.source, "twilight-feather-newsletter");
  assert.equal(
    (params as { first_time_transaction?: boolean }).first_time_transaction,
    undefined,
  );
});

test("new signup issues customer-specific promotion with correct Stripe params", async () => {
  __setNewsletterStripeCouponIdForTests(COUPON);
  let createParams: Stripe.PromotionCodeCreateParams | null = null;
  const recorded: NewsletterPromotionIssuanceRow[] = [];

  const stripe = mockStripe({
    stripeCustomerId: "cus_subscriber_1",
    listPromotions: async () => ({ data: [] }),
    createPromotion: async (params) => {
      createParams = params;
      return { id: "promo_new_customer" } as Stripe.PromotionCode;
    },
  });

  const result = await issueCustomerSpecificNewsletterPromotion(
    stripe,
    "new-subscriber@example.com",
    "signup",
    {
      testOverrides: {
        hasRedeemed: async () => false,
        getIssuanceByEmail: async () => null,
        recordIssuance: async (input) => {
          const row: NewsletterPromotionIssuanceRow = {
            email: input.email,
            stripe_customer_id: input.stripeCustomerId,
            stripe_promotion_code_id: input.stripePromotionCodeId,
            stripe_coupon_id: input.stripeCouponId,
            issued_at: new Date(),
            issuance_source: input.issuanceSource,
            last_error: null,
            migration_run_id: null,
          };
          recorded.push(row);
          return row;
        },
        resolveCouponId: async () => COUPON,
      },
    },
  );

  assert.equal(result.status, "issued");
  assert.ok(createParams);
  const captured = createParams as Stripe.PromotionCodeCreateParams;
  assert.equal(captured.customer, "cus_subscriber_1");
  assert.equal(
    captured.promotion.type === "coupon" ? captured.promotion.coupon : null,
    COUPON,
  );
  assert.equal(captured.code, "TWILIGHTFEATHER10");
  assert.equal(captured.max_redemptions, 1);
  assert.equal(captured.metadata?.scope, "customer");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].issuance_source, "signup");
});

test("second signup for same email returns existing without creating another promo", async () => {
  __setNewsletterStripeCouponIdForTests(COUPON);
  let createCalls = 0;

  const stripe = mockStripe({
    listPromotions: async () => ({ data: [] }),
    createPromotion: async () => {
      createCalls += 1;
      return { id: "promo_should_not_run" } as Stripe.PromotionCode;
    },
  });

  const existingRow: NewsletterPromotionIssuanceRow = {
    email: "repeat@example.com",
    stripe_customer_id: "cus_repeat",
    stripe_promotion_code_id: "promo_existing",
    stripe_coupon_id: COUPON,
    issued_at: new Date(),
    issuance_source: "signup",
    last_error: null,
    migration_run_id: null,
  };

  const result = await issueCustomerSpecificNewsletterPromotion(
    stripe,
    "repeat@example.com",
    "signup",
    {
      testOverrides: {
        hasRedeemed: async () => false,
        getIssuanceByEmail: async () => existingRow,
        resolveCouponId: async () => COUPON,
      },
    },
  );

  assert.equal(result.status, "existing");
  assert.equal(createCalls, 0);
  if (result.status === "existing") {
    assert.equal(result.stripePromotionCodeId, "promo_existing");
  }
});

test("existing newsletter redemption skips issuance", async () => {
  __setNewsletterStripeCouponIdForTests(COUPON);
  let createCalls = 0;
  const stripe = mockStripe({
    createPromotion: async () => {
      createCalls += 1;
      return { id: "promo_x" } as Stripe.PromotionCode;
    },
  });

  const result = await issueCustomerSpecificNewsletterPromotion(
    stripe,
    "redeemed@example.com",
    "signup",
    {
      testOverrides: {
        hasRedeemed: async () => true,
        resolveCouponId: async () => COUPON,
      },
    },
  );

  assert.equal(result.status, "skipped");
  if (result.status === "skipped") {
    assert.equal(result.reason, "already_redeemed");
  }
  assert.equal(createCalls, 0);
});

test("reconciles existing Stripe promo without duplicate create", async () => {
  __setNewsletterStripeCouponIdForTests(COUPON);
  let createCalls = 0;
  const existingPromo = {
    id: "promo_stripe_only",
    object: "promotion_code",
    code: "TWILIGHTFEATHER10",
    promotion: { type: "coupon", coupon: COUPON },
  } as Stripe.PromotionCode;

  const stripe = mockStripe({
    stripeCustomerId: "cus_reconcile",
    listPromotions: async () => ({ data: [existingPromo] }),
    createPromotion: async () => {
      createCalls += 1;
      return { id: "promo_new" } as Stripe.PromotionCode;
    },
  });

  let recorded = false;
  const result = await issueCustomerSpecificNewsletterPromotion(
    stripe,
    "reconcile@example.com",
    "signup",
    {
      testOverrides: {
        hasRedeemed: async () => false,
        getIssuanceByEmail: async () => null,
        recordIssuance: async () => {
          recorded = true;
          return {
            email: "reconcile@example.com",
            stripe_customer_id: "cus_reconcile",
            stripe_promotion_code_id: "promo_stripe_only",
            stripe_coupon_id: COUPON,
            issued_at: new Date(),
            issuance_source: "signup",
            last_error: null,
            migration_run_id: null,
          };
        },
        resolveCouponId: async () => COUPON,
      },
    },
  );

  assert.equal(result.status, "existing");
  assert.equal(createCalls, 0);
  assert.equal(recorded, true);
});

test("multiple matching Stripe promos fails safely", async () => {
  __setNewsletterStripeCouponIdForTests(COUPON);
  const stripe = mockStripe({
    stripeCustomerId: "cus_dup",
    listPromotions: async () => ({
      data: [
        {
          id: "promo_a",
          promotion: { coupon: COUPON },
        } as Stripe.PromotionCode,
        {
          id: "promo_b",
          promotion: { coupon: COUPON },
        } as Stripe.PromotionCode,
      ],
    }),
  });

  const result = await issueCustomerSpecificNewsletterPromotion(
    stripe,
    "ambiguous@example.com",
    "signup",
    {
      testOverrides: {
        hasRedeemed: async () => false,
        getIssuanceByEmail: async () => null,
        resolveCouponId: async () => COUPON,
      },
    },
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "ambiguous_stripe_promotions");
  }
});

test("HOLIDAY2026 is not treated as newsletter promotion", () => {
  const holiday = {
    id: "promo_holiday",
    code: "HOLIDAY2026",
    promotion: { type: "coupon", coupon: COUPON },
  } as Stripe.PromotionCode;
  assert.equal(
    isNewsletterCouponPromotionApplication(holiday, COUPON),
    false,
  );
});

test("attemptNewsletterPromotionIssuanceAfterSignup does not throw when issuance fails", async () => {
  await attemptNewsletterPromotionIssuanceAfterSignup("safe@example.com", {
    createStripe: () => ({}) as Stripe,
    issueFn: async () => {
      throw new Error("stripe down");
    },
  });
});

test("leads signup route triggers issuance after upsert without exposing coupon env", () => {
  const route = readFileSync(
    new URL("../app/api/leads/route.ts", import.meta.url),
    "utf8",
  );
  const upsertIdx = route.indexOf("await upsertLead(email)");
  const issuanceIdx = route.indexOf(
    "await attemptNewsletterPromotionIssuanceAfterSignup(email)",
  );
  assert.ok(upsertIdx >= 0 && issuanceIdx > upsertIdx);
  assert.doesNotMatch(route, /NEWSLETTER_STRIPE_COUPON_ID/);
  assert.match(route, /getNewsletterDiscountCode\(\)/);
});

test("ensureNewsletterPromotionCode path does not modify global promo in issuance module", () => {
  const issuance = readFileSync(
    new URL("./newsletter-promotion-issuance.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(issuance, /ensureNewsletterPromotionCode/);
  assert.doesNotMatch(issuance, /promotionCodes\.update/);
  assert.doesNotMatch(issuance, /active:\s*false/);
});

test(
  "newsletter_promotion_issuances database (NEWSLETTER_ISSUANCE_TEST_DATABASE_URL)",
  { skip: !process.env.NEWSLETTER_ISSUANCE_TEST_DATABASE_URL?.trim() },
  async () => {
    process.env.DATABASE_URL =
      process.env.NEWSLETTER_ISSUANCE_TEST_DATABASE_URL!.trim();

    const email = `issuance-test-${Date.now()}@example.com`;
    const promoA = `promo_a_${Date.now()}`;
    const promoB = `promo_b_${Date.now()}`;

    const first = await recordNewsletterPromotionIssuance({
      email,
      stripeCustomerId: "cus_first",
      stripePromotionCodeId: promoA,
      stripeCouponId: "coupon_test",
      issuanceSource: "signup",
    });
    assert.equal(first.stripe_promotion_code_id, promoA);

    const second = await recordNewsletterPromotionIssuance({
      email,
      stripeCustomerId: "cus_should_not_replace",
      stripePromotionCodeId: promoB,
      stripeCouponId: "coupon_test",
      issuanceSource: "migration",
    });
    assert.equal(second.stripe_promotion_code_id, promoA);
    assert.equal(second.stripe_customer_id, "cus_first");

    const lookup = await getNewsletterPromotionIssuanceByEmail(email);
    assert.ok(lookup);
    assert.equal(lookup!.email, email.toLowerCase());

    const otherEmail = `issuance-other-${Date.now()}@example.com`;
    await assert.rejects(
      () =>
        recordNewsletterPromotionIssuance({
          email: otherEmail,
          stripeCustomerId: "cus_other",
          stripePromotionCodeId: promoA,
          stripeCouponId: "coupon_test",
          issuanceSource: "signup",
        }),
      /duplicate|unique|violates/i,
    );
  },
);
