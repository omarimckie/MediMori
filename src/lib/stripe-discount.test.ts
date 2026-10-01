import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import type Stripe from "stripe";
import {
  __setNewsletterStripeCouponIdForTests,
  getNewsletterStripeCouponId,
  isNewsletterCouponPromotionApplication,
  promotionCodeCouponId,
  resolveNewsletterCouponIdForIssuance,
} from "./stripe-discount";

const TEST_COUPON = "coupon_test_newsletter";

afterEach(() => {
  __setNewsletterStripeCouponIdForTests(undefined);
});

function mockPromotionCode(
  overrides: Partial<Stripe.PromotionCode> & {
    id: string;
    couponId: string;
    code?: string;
  },
): Stripe.PromotionCode {
  const { id, couponId, code, ...rest } = overrides;
  return {
    object: "promotion_code",
    active: true,
    ...rest,
    id,
    code: code ?? "TWILIGHTFEATHER10",
    promotion: { type: "coupon", coupon: couponId },
  } as Stripe.PromotionCode;
}

test("getNewsletterStripeCouponId reads NEWSLETTER_STRIPE_COUPON_ID", () => {
  assert.equal(
    getNewsletterStripeCouponId({ NEWSLETTER_STRIPE_COUPON_ID: "coupon_live_abc" }),
    "coupon_live_abc",
  );
  assert.equal(getNewsletterStripeCouponId({}), null);
  assert.equal(
    getNewsletterStripeCouponId({ NEWSLETTER_STRIPE_COUPON_ID: "not_a_coupon" }),
    null,
  );
});

test("test override for newsletter coupon id", () => {
  __setNewsletterStripeCouponIdForTests("coupon_from_test");
  assert.equal(getNewsletterStripeCouponId(), "coupon_from_test");
});

test("newsletter promotion detection uses code + coupon, not promo id", () => {
  const globalPromo = mockPromotionCode({
    id: "promo_global",
    couponId: TEST_COUPON,
  });
  const customerPromo = mockPromotionCode({
    id: "promo_customer_xyz",
    couponId: TEST_COUPON,
  });

  assert.equal(promotionCodeCouponId(globalPromo), TEST_COUPON);
  assert.equal(
    isNewsletterCouponPromotionApplication(globalPromo, TEST_COUPON),
    true,
  );
  assert.equal(
    isNewsletterCouponPromotionApplication(customerPromo, TEST_COUPON),
    true,
  );
});

test("TWILIGHTFEATHER10 with a different coupon is not newsletter", () => {
  const wrongCoupon = mockPromotionCode({
    id: "promo_fake_twilight",
    couponId: "coupon_holiday_10",
    code: "TWILIGHTFEATHER10",
  });
  assert.equal(
    isNewsletterCouponPromotionApplication(wrongCoupon, TEST_COUPON),
    false,
  );
});

test("resolveNewsletterCouponIdForIssuance requires env in production", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  __setNewsletterStripeCouponIdForTests(null);
  const stripe = {
    promotionCodes: {
      list: async () => {
        throw new Error("should not list in production issuance");
      },
    },
  } as unknown as Stripe;
  const coupon = await resolveNewsletterCouponIdForIssuance(stripe);
  assert.equal(coupon, null);
  process.env.VERCEL_ENV = prev;
});

test("HOLIDAY2026 with newsletter coupon is not newsletter", () => {
  const holiday = mockPromotionCode({
    id: "promo_holiday",
    couponId: TEST_COUPON,
    code: "HOLIDAY2026",
  });
  assert.equal(
    isNewsletterCouponPromotionApplication(holiday, TEST_COUPON),
    false,
  );
});
