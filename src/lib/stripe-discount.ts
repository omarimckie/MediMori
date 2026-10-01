import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import Stripe from "stripe";

let ensurePromise: Promise<void> | null = null;

let newsletterStripeCouponIdOverride: string | null | undefined;

/**
 * Pinned newsletter coupon id (coupon_...) from NEWSLETTER_STRIPE_COUPON_ID.
 * Production should set this explicitly. Tests may override via __setNewsletterStripeCouponIdForTests.
 */
export function getNewsletterStripeCouponId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (newsletterStripeCouponIdOverride !== undefined) {
    return newsletterStripeCouponIdOverride;
  }
  const fromEnv = env.NEWSLETTER_STRIPE_COUPON_ID?.trim();
  if (!fromEnv) return null;
  return fromEnv.startsWith("coupon_") ? fromEnv : null;
}

/** @internal Test-only override for getNewsletterStripeCouponId. */
export function __setNewsletterStripeCouponIdForTests(
  couponId: string | null | undefined,
): void {
  newsletterStripeCouponIdOverride = couponId;
}

function couponIdFromPromotionCodeObject(
  promotionCode: Stripe.PromotionCode,
): string | null {
  const coupon = promotionCode.promotion?.coupon;
  if (!coupon) return null;
  if (typeof coupon === "string") return coupon;
  return coupon.id ?? null;
}

/**
 * Resolves the newsletter coupon id from env, or by reading the global TWILIGHTFEATHER10 promo.
 * Does not create coupons. Used when NEWSLETTER_STRIPE_COUPON_ID is unset (e.g. local dev).
 */
export async function resolveNewsletterStripeCouponId(
  stripe: Stripe,
): Promise<string | null> {
  const pinned = getNewsletterStripeCouponId();
  if (pinned) return pinned;

  const promoId = await resolveNewsletterPromotionCodeId(stripe);
  if (!promoId) return null;

  const promotionCode = await stripe.promotionCodes.retrieve(promoId, {
    expand: ["promotion.coupon"],
  });
  return couponIdFromPromotionCodeObject(promotionCode);
}

export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Coupon id for customer-specific newsletter issuance.
 * Production requires NEWSLETTER_STRIPE_COUPON_ID (no auto-create / list discovery).
 */
export async function resolveNewsletterCouponIdForIssuance(
  stripe: Stripe,
): Promise<string | null> {
  const pinned = getNewsletterStripeCouponId();
  if (pinned) return pinned;
  if (isProductionDeployment()) {
    return null;
  }
  return resolveNewsletterStripeCouponId(stripe);
}

/**
 * Resolves one active global TWILIGHTFEATHER10 promotion code id (legacy helper).
 * Not authoritative when multiple customer-specific codes share the same string.
 */
export async function resolveNewsletterPromotionCodeId(
  stripe: Stripe,
): Promise<string | null> {
  const code = getNewsletterDiscountCode();

  const active = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });
  if (active.data[0]?.id) {
    return active.data[0].id;
  }

  const inactive = await stripe.promotionCodes.list({
    code,
    active: false,
    limit: 1,
  });
  return inactive.data[0]?.id ?? null;
}

/**
 * Ensures Stripe has a 10% once-use coupon and a promotion code matching
 * the site's newsletter discount code (default TWILIGHTFEATHER10).
 *
 * Existing live coupons are not modified. When a new coupon must be created,
 * set NEWSLETTER_DISCOUNT_STRIPE_PRODUCT_IDS (comma-separated Stripe Product IDs)
 * in the Dashboard or env to scope the discount to eligible direct-site products.
 * Production coupon scope changes require a manual Stripe Dashboard update.
 *
 * Per-customer one-time use is enforced in Postgres (newsletter_promotion_redemptions).
 * Customer-specific promotion codes are issued separately (see newsletter-promotion-issuance).
 */
export async function ensureNewsletterPromotionCode(
  stripe: Stripe,
): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = createPromotionCodeIfMissing(stripe).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

async function createPromotionCodeIfMissing(stripe: Stripe): Promise<void> {
  const code = getNewsletterDiscountCode();

  const existing = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0) return;

  const inactive = await stripe.promotionCodes.list({
    code,
    active: false,
    limit: 1,
  });
  if (inactive.data.length > 0) {
    await stripe.promotionCodes.update(inactive.data[0].id, { active: true });
    return;
  }

  const productScope = process.env.NEWSLETTER_DISCOUNT_STRIPE_PRODUCT_IDS
    ?.split(",")
    .map((id) => id.trim())
    .filter((id) => id.startsWith("prod_"));

  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration: "once",
    name: "Email list — 10% off direct purchases",
    ...(productScope?.length
      ? { applies_to: { products: productScope } }
      : {}),
    metadata: {
      source: "twilight-feather-newsletter",
      promotion_code: code,
    },
  });

  await stripe.promotionCodes.create({
    promotion: {
      type: "coupon",
      coupon: coupon.id,
    },
    code,
    active: true,
    metadata: {
      source: "twilight-feather-newsletter",
    },
  });
}

export function promotionCodeCouponId(
  promotionCode: Stripe.PromotionCode,
): string | null {
  return couponIdFromPromotionCodeObject(promotionCode);
}

export function isNewsletterCustomerFacingPromotionCode(
  promotionCode: Stripe.PromotionCode,
): boolean {
  const expected = getNewsletterDiscountCode().trim().toLowerCase();
  const actual = promotionCode.code?.trim().toLowerCase() ?? "";
  return actual === expected;
}

export function isNewsletterCouponPromotionApplication(
  promotionCode: Stripe.PromotionCode,
  newsletterCouponId: string,
): boolean {
  if (!isNewsletterCustomerFacingPromotionCode(promotionCode)) {
    return false;
  }
  const couponId = promotionCodeCouponId(promotionCode);
  return couponId === newsletterCouponId;
}
