import { customerEmailFromSession, normalizeEmail } from "./checkout-ownership";
import { getSql } from "./db";
import {
  isNewsletterDiscountedEbookCheckoutAmount,
  isNewsletterDiscountedPhysicalCheckoutAmount,
  isNewsletterEligibleDirectBook,
} from "./newsletter-discount-pricing";
import {
  paymentIntentIdFromCheckoutSession,
  refundStripePaymentIntent,
} from "./stripe-payment-refund";
import { resolveNewsletterPromotionCodeId } from "./stripe-discount";
import type Stripe from "stripe";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewsletterRedemptionContext =
  | { purchaseType: "ebook"; bookId: string }
  | { purchaseType: "physical"; bookId: string; quantity: number };

export type RedemptionEmailValidation =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" };

export type NewsletterDiscountSessionAnalysis =
  | { status: "not_newsletter_discount" }
  | { status: "newsletter_redemption"; email: string }
  | { status: "invalid"; reason: string };

export type ClaimNewsletterRedemptionResult =
  | { status: "claimed" }
  | { status: "idempotent" }
  | { status: "already_redeemed" };

export type EnsurePaidNewsletterRedemptionResult =
  | { ok: true; consumedNewsletterRedemption: boolean }
  | { ok: false; reason: "duplicate_newsletter_redemption"; refunded: boolean }
  | { ok: false; reason: "invalid_newsletter_discount"; refunded: boolean };

export function validateRedemptionEmail(value: string): RedemptionEmailValidation {
  const email = normalizeEmail(value);
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, email };
}

function sessionAmountDiscountCents(session: Stripe.Checkout.Session): number {
  const discount = session.total_details?.amount_discount;
  return typeof discount === "number" && discount > 0 ? discount : 0;
}

function sessionAmountTotalCents(session: Stripe.Checkout.Session): number | null {
  return typeof session.amount_total === "number" ? session.amount_total : null;
}

/** Promotion code ids applied on a paid Checkout Session (requires discounts expanded when retrieved). */
export function checkoutSessionAppliedPromotionCodeIds(
  session: Stripe.Checkout.Session,
): string[] {
  const ids: string[] = [];
  for (const discount of session.discounts ?? []) {
    const promotionCode = discount.promotion_code;
    if (!promotionCode) continue;
    if (typeof promotionCode === "string") {
      ids.push(promotionCode);
      continue;
    }
    if (promotionCode.id) {
      ids.push(promotionCode.id);
    }
  }
  return ids;
}

function sessionUsesNewsletterPromotionCode(
  session: Stripe.Checkout.Session,
  newsletterPromotionCodeId: string | null,
): boolean {
  if (!newsletterPromotionCodeId) return false;
  return checkoutSessionAppliedPromotionCodeIds(session).includes(
    newsletterPromotionCodeId,
  );
}

/**
 * Detects a paid checkout that used the live TWILIGHTFEATHER10 promotion code and
 * matches centralized newsletter pricing rules (not amount_total alone).
 */
export function analyzePaidCheckoutSessionNewsletterDiscount(
  session: Stripe.Checkout.Session,
  context: NewsletterRedemptionContext,
  newsletterPromotionCodeId: string | null,
): NewsletterDiscountSessionAnalysis {
  const amountDiscount = sessionAmountDiscountCents(session);
  if (amountDiscount <= 0) {
    return { status: "not_newsletter_discount" };
  }

  if (!sessionUsesNewsletterPromotionCode(session, newsletterPromotionCodeId)) {
    return { status: "not_newsletter_discount" };
  }

  const email = customerEmailFromSession(session);
  const emailCheck = validateRedemptionEmail(email);
  if (!emailCheck.ok) {
    return { status: "invalid", reason: "missing_customer_email" };
  }

  if (
    !isNewsletterEligibleDirectBook(context.bookId, context.purchaseType)
  ) {
    return { status: "invalid", reason: "ineligible_product" };
  }

  const amountTotal = sessionAmountTotalCents(session);
  if (amountTotal === null) {
    return { status: "invalid", reason: "missing_amount_total" };
  }

  if (context.purchaseType === "ebook") {
    if (!isNewsletterDiscountedEbookCheckoutAmount(amountTotal)) {
      return { status: "invalid", reason: "ebook_total_mismatch" };
    }
    return { status: "newsletter_redemption", email: emailCheck.email };
  }

  if (
    !isNewsletterDiscountedPhysicalCheckoutAmount(
      amountTotal,
      context.quantity,
    )
  ) {
    return { status: "invalid", reason: "physical_total_mismatch" };
  }

  return { status: "newsletter_redemption", email: emailCheck.email };
}

export async function hasRedeemedNewsletterPromotion(
  email: string,
): Promise<boolean> {
  const validated = validateRedemptionEmail(email);
  if (!validated.ok) return false;

  const sql = getSql();
  const rows = await sql`
    SELECT 1
    FROM newsletter_promotion_redemptions
    WHERE email = ${validated.email}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getNewsletterRedemptionBySessionId(
  stripeCheckoutSessionId: string,
): Promise<{ email: string } | null> {
  const sessionId = stripeCheckoutSessionId.trim();
  if (!sessionId) return null;

  const sql = getSql();
  const rows = await sql`
    SELECT email
    FROM newsletter_promotion_redemptions
    WHERE stripe_checkout_session_id = ${sessionId}
    LIMIT 1
  `;
  const row = rows[0] as { email?: string } | undefined;
  if (!row?.email) return null;
  return { email: normalizeEmail(row.email) };
}

/**
 * Atomically records one newsletter redemption per email after successful paid checkout.
 * Webhook retries for the same session are idempotent.
 */
export async function claimNewsletterPromotionRedemption(
  email: string,
  stripeCheckoutSessionId: string,
): Promise<ClaimNewsletterRedemptionResult> {
  const validated = validateRedemptionEmail(email);
  if (!validated.ok) {
    throw new Error("Invalid redemption email.");
  }

  const sessionId = stripeCheckoutSessionId.trim();
  if (!sessionId) {
    throw new Error("Checkout session id is required.");
  }

  const existingSession = await getNewsletterRedemptionBySessionId(sessionId);
  if (existingSession) {
    return { status: "idempotent" };
  }

  const sql = getSql();
  const inserted = await sql`
    INSERT INTO newsletter_promotion_redemptions (email, stripe_checkout_session_id)
    VALUES (${validated.email}, ${sessionId})
    ON CONFLICT (email) DO NOTHING
    RETURNING email
  `;

  if (inserted.length > 0) {
    return { status: "claimed" };
  }

  const afterConflict = await getNewsletterRedemptionBySessionId(sessionId);
  if (afterConflict) {
    return { status: "idempotent" };
  }

  return { status: "already_redeemed" };
}

/**
 * Claims newsletter redemption before fulfillment when the paid session used the promo.
 * Duplicate successful discounted checkouts for the same email are refunded, not fulfilled.
 */
export async function ensurePaidNewsletterRedemptionBeforeFulfillment(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  context: NewsletterRedemptionContext,
): Promise<EnsurePaidNewsletterRedemptionResult> {
  const newsletterPromotionCodeId = await resolveNewsletterPromotionCodeId(stripe);
  const analysis = analyzePaidCheckoutSessionNewsletterDiscount(
    session,
    context,
    newsletterPromotionCodeId,
  );
  if (analysis.status === "not_newsletter_discount") {
    return { ok: true, consumedNewsletterRedemption: false };
  }

  const paymentIntentId = paymentIntentIdFromCheckoutSession(session);

  if (analysis.status === "invalid") {
    let refunded = false;
    if (paymentIntentId) {
      refunded = await refundStripePaymentIntent(stripe, paymentIntentId);
    }
    console.error("Invalid newsletter discount on paid checkout:", {
      sessionId: session.id,
      reason: analysis.reason,
      refunded,
    });
    return { ok: false, reason: "invalid_newsletter_discount", refunded };
  }

  const claim = await claimNewsletterPromotionRedemption(
    analysis.email,
    session.id,
  );

  if (claim.status === "claimed" || claim.status === "idempotent") {
    return { ok: true, consumedNewsletterRedemption: true };
  }

  let refunded = false;
  if (paymentIntentId) {
    refunded = await refundStripePaymentIntent(stripe, paymentIntentId);
  }
  console.error("Duplicate newsletter promotion redemption blocked:", {
    sessionId: session.id,
    email: analysis.email,
    refunded,
  });
  return { ok: false, reason: "duplicate_newsletter_redemption", refunded };
}
