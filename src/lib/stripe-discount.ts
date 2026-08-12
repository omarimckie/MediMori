import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import Stripe from "stripe";

let ensurePromise: Promise<void> | null = null;

/**
 * Ensures Stripe has a 10% once-use coupon and a promotion code matching
 * the site's newsletter discount code (default TWILIGHTFEATHER10).
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

  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration: "once",
    name: "Email list — 10% off",
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
