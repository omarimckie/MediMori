import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import Stripe from "stripe";

let ensurePromise: Promise<void> | null = null;

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
 * For a secondary Stripe layer, set max redemptions per customer on the live promotion
 * code in the Stripe Dashboard (the current Stripe SDK does not expose
 * max_redemptions_per_customer on programmatic promotion code creation).
 */
/**
 * Resolves the active Stripe Promotion Code id for TWILIGHTFEATHER10 (or env override).
 * Returns null when the code is not present in the connected Stripe account.
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
