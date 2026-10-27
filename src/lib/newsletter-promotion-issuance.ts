import {
  hasRedeemedNewsletterPromotion,
  validateRedemptionEmail,
} from "./newsletter-promotion-redemption";
import { getNewsletterDiscountCode } from "./newsletter-constants";
import { getSql } from "./db";
import {
  findOrCreateStripeCustomerByEmail,
  searchStripeCustomersByEmail,
} from "./stripe-customer";
import {
  findActiveUnrestrictedNewsletterPromotionForCoupon,
  getNewsletterStripeCouponId,
  resolveNewsletterCouponIdForIssuance,
} from "./stripe-discount";
import { stripeErrorDiagnostics } from "./stripe-error-diagnostics";
import Stripe from "stripe";

export type NewsletterIssuanceSource =
  | "signup"
  | "migration"
  | "checkout_backfill";

export type NewsletterPromotionIssuanceRow = {
  email: string;
  stripe_customer_id: string;
  stripe_promotion_code_id: string;
  stripe_coupon_id: string;
  issued_at: Date;
  issuance_source: NewsletterIssuanceSource;
  last_error: string | null;
  migration_run_id: string | null;
};

export type CreateIssuanceRecordInput = {
  email: string;
  stripeCustomerId: string;
  stripePromotionCodeId: string;
  stripeCouponId: string;
  issuanceSource: NewsletterIssuanceSource;
  migrationRunId?: string | null;
};

/** Parameters for a customer-restricted TWILIGHTFEATHER10 promotion (Option B). */
export function buildCustomerSpecificPromotionCodeCreateParams(
  stripeCustomerId: string,
  couponId: string,
  options?: { migrationRunId?: string },
): Stripe.PromotionCodeCreateParams {
  const metadata: Record<string, string> = {
    source: "twilight-feather-newsletter",
    scope: "customer",
  };
  if (options?.migrationRunId) {
    metadata.issuance_source = "migration";
    metadata.migration_run_id = options.migrationRunId;
  }
  return {
    promotion: { type: "coupon", coupon: couponId },
    code: getNewsletterDiscountCode(),
    customer: stripeCustomerId,
    max_redemptions: 1,
    active: true,
    metadata,
  };
}

function promotionCodeMatchesNewsletterCoupon(
  promotionCode: Stripe.PromotionCode,
  couponId: string,
): boolean {
  const appliedCoupon =
    typeof promotionCode.promotion?.coupon === "string"
      ? promotionCode.promotion.coupon
      : promotionCode.promotion?.coupon?.id;
  return appliedCoupon === couponId;
}

/**
 * Lists customer-restricted TWILIGHTFEATHER10 promos for a customer + newsletter coupon.
 * Includes active and inactive codes for reconciliation.
 */
export async function listCustomerSpecificNewsletterPromotionCodes(
  stripe: Stripe,
  stripeCustomerId: string,
  couponId: string,
): Promise<Stripe.PromotionCode[]> {
  const code = getNewsletterDiscountCode();
  const matches: Stripe.PromotionCode[] = [];
  const seen = new Set<string>();

  for (const active of [true, false] as const) {
    const listed = await stripe.promotionCodes.list({
      code,
      customer: stripeCustomerId,
      active,
      limit: 100,
    });
    for (const promotionCode of listed.data) {
      if (!promotionCode.id || seen.has(promotionCode.id)) continue;
      if (!promotionCodeMatchesNewsletterCoupon(promotionCode, couponId)) {
        continue;
      }
      seen.add(promotionCode.id);
      matches.push(promotionCode);
    }
  }

  return matches;
}

export async function findCustomerSpecificNewsletterPromotionCode(
  stripe: Stripe,
  stripeCustomerId: string,
  couponId: string,
): Promise<Stripe.PromotionCode | null> {
  const matches = await listCustomerSpecificNewsletterPromotionCodes(
    stripe,
    stripeCustomerId,
    couponId,
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return null;
}

export async function getNewsletterPromotionIssuanceByEmail(
  email: string,
): Promise<NewsletterPromotionIssuanceRow | null> {
  const validated = validateRedemptionEmail(email);
  if (!validated.ok) return null;

  const sql = getSql();
  const rows = await sql`
    SELECT
      email,
      stripe_customer_id,
      stripe_promotion_code_id,
      stripe_coupon_id,
      issued_at,
      issuance_source,
      last_error,
      migration_run_id
    FROM newsletter_promotion_issuances
    WHERE email = ${validated.email}
    LIMIT 1
  `;
  const row = rows[0] as NewsletterPromotionIssuanceRow | undefined;
  return row ?? null;
}

export async function recordNewsletterPromotionIssuanceFailure(
  email: string,
  message: string,
): Promise<void> {
  const validated = validateRedemptionEmail(email);
  if (!validated.ok) return;

  const sql = getSql();
  await sql`
    UPDATE newsletter_promotion_issuances
    SET last_error = ${message.slice(0, 2000)}
    WHERE email = ${validated.email}
  `;
}

/**
 * Persists one issuance row per email. Idempotent on email (first row wins).
 */
export async function recordNewsletterPromotionIssuance(
  input: CreateIssuanceRecordInput,
): Promise<NewsletterPromotionIssuanceRow> {
  const validated = validateRedemptionEmail(input.email);
  if (!validated.ok) {
    throw new Error("Invalid issuance email.");
  }

  const customerId = input.stripeCustomerId.trim();
  const promoId = input.stripePromotionCodeId.trim();
  const couponId = input.stripeCouponId.trim();
  if (!customerId || !promoId || !couponId) {
    throw new Error("Stripe ids are required for issuance.");
  }

  const sql = getSql();
  const inserted = await sql`
    INSERT INTO newsletter_promotion_issuances (
      email,
      stripe_customer_id,
      stripe_promotion_code_id,
      stripe_coupon_id,
      issuance_source,
      migration_run_id,
      last_error
    )
    VALUES (
      ${validated.email},
      ${customerId},
      ${promoId},
      ${couponId},
      ${input.issuanceSource},
      ${input.migrationRunId ?? null},
      NULL
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING
      email,
      stripe_customer_id,
      stripe_promotion_code_id,
      stripe_coupon_id,
      issued_at,
      issuance_source,
      last_error,
      migration_run_id
  `;
  if (inserted.length > 0) {
    return inserted[0] as NewsletterPromotionIssuanceRow;
  }

  const existing = await getNewsletterPromotionIssuanceByEmail(validated.email);
  if (!existing) {
    throw new Error("Issuance insert conflicted but row is missing.");
  }
  return existing;
}

export type IssueCustomerNewsletterPromotionResult =
  | {
      status: "issued";
      stripePromotionCodeId: string;
      stripeCustomerId: string;
    }
  | {
      status: "existing";
      stripePromotionCodeId: string;
      stripeCustomerId: string;
    }
  | {
      status: "skipped";
      reason:
        | "invalid_email"
        | "already_redeemed"
        | "missing_coupon_id"
        | "deferred_global_code_active"
        | "stripe_not_configured"
        | "database_unavailable";
    }
  | {
      status: "failed";
      reason:
        | "ambiguous_stripe_promotions"
        | "ambiguous_stripe_customers"
        | "stripe_error"
        | "database_error";
    };

export type IssueCustomerNewsletterPromotionOptions = {
  migrationRunId?: string | null;
  /** @internal Optional overrides for unit tests (never use in production routes). */
  testOverrides?: {
    hasRedeemed?: (email: string) => Promise<boolean>;
    getIssuanceByEmail?: (
      email: string,
    ) => Promise<NewsletterPromotionIssuanceRow | null>;
    recordIssuance?: (
      input: CreateIssuanceRecordInput,
    ) => Promise<NewsletterPromotionIssuanceRow>;
    resolveCouponId?: (stripe: Stripe) => Promise<string | null>;
    findActiveUnrestrictedGlobal?: (
      stripe: Stripe,
      couponId: string,
    ) => Promise<Stripe.PromotionCode | null>;
    searchCustomersByEmail?: (
      stripe: Stripe,
      email: string,
    ) => Promise<Stripe.Customer[]>;
  };
};

function logStripeIssuanceError(context: string, error: unknown): void {
  console.error(context, stripeErrorDiagnostics(error));
}

async function reconcileCustomerNewsletterPromotionWhenPossible(
  stripe: Stripe,
  stripeCustomerId: string,
  couponId: string,
  email: string,
  issuanceSource: NewsletterIssuanceSource,
  options: IssueCustomerNewsletterPromotionOptions | undefined,
  recordIssuance: (
    input: CreateIssuanceRecordInput,
  ) => Promise<NewsletterPromotionIssuanceRow>,
): Promise<IssueCustomerNewsletterPromotionResult | null> {
  let customerPromos: Stripe.PromotionCode[];
  try {
    customerPromos = await listCustomerSpecificNewsletterPromotionCodes(
      stripe,
      stripeCustomerId,
      couponId,
    );
  } catch (error) {
    logStripeIssuanceError(
      "Newsletter issuance: Stripe promotion list error:",
      error,
    );
    return { status: "failed", reason: "stripe_error" };
  }

  if (customerPromos.length > 1) {
    console.error("Newsletter issuance: multiple customer-specific promos found.", {
      stripeCustomerId,
      promotionCodeIds: customerPromos.map((p) => p.id),
    });
    return { status: "failed", reason: "ambiguous_stripe_promotions" };
  }

  if (customerPromos.length === 1 && customerPromos[0].id) {
    const reconciled = customerPromos[0];
    try {
      await recordIssuance({
        email,
        stripeCustomerId,
        stripePromotionCodeId: reconciled.id,
        stripeCouponId: couponId,
        issuanceSource,
        migrationRunId: options?.migrationRunId ?? null,
      });
    } catch (error) {
      console.error("Newsletter issuance: failed to record reconciled promo:", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return { status: "failed", reason: "database_error" };
    }
    return {
      status: "existing",
      stripePromotionCodeId: reconciled.id,
      stripeCustomerId,
    };
  }

  return null;
}

/**
 * While an active unrestricted global newsletter code exists, new customer-specific
 * codes cannot be created. Reconcile existing Stripe state when possible without
 * creating customers or promotion codes.
 */
async function issueWhenGlobalNewsletterCodeActive(
  stripe: Stripe,
  email: string,
  couponId: string,
  issuanceSource: NewsletterIssuanceSource,
  options: IssueCustomerNewsletterPromotionOptions | undefined,
  recordIssuance: (
    input: CreateIssuanceRecordInput,
  ) => Promise<NewsletterPromotionIssuanceRow>,
): Promise<IssueCustomerNewsletterPromotionResult> {
  const searchCustomers =
    options?.testOverrides?.searchCustomersByEmail ??
    ((s, e) => searchStripeCustomersByEmail(s, e, { limit: 20 }));

  let customers: Stripe.Customer[];
  try {
    customers = await searchCustomers(stripe, email);
  } catch (error) {
    logStripeIssuanceError("Newsletter issuance: Stripe customer search error:", error);
    return { status: "failed", reason: "stripe_error" };
  }

  if (customers.length === 0) {
    return { status: "skipped", reason: "deferred_global_code_active" };
  }

  if (customers.length > 1) {
    console.error(
      "Newsletter issuance: multiple Stripe customers match email during global defer.",
      { matchCount: customers.length },
    );
    return { status: "failed", reason: "ambiguous_stripe_customers" };
  }

  const stripeCustomerId = customers[0].id;
  if (!stripeCustomerId) {
    return { status: "skipped", reason: "deferred_global_code_active" };
  }

  const reconciled = await reconcileCustomerNewsletterPromotionWhenPossible(
    stripe,
    stripeCustomerId,
    couponId,
    email,
    issuanceSource,
    options,
    recordIssuance,
  );
  if (reconciled) {
    return reconciled;
  }

  return { status: "skipped", reason: "deferred_global_code_active" };
}

export type IssueCustomerNewsletterPromotionFn = (
  stripe: Stripe,
  email: string,
  issuanceSource: NewsletterIssuanceSource,
  options?: IssueCustomerNewsletterPromotionOptions,
) => Promise<IssueCustomerNewsletterPromotionResult>;

/**
 * Idempotent Stripe + DB issuance for one subscriber email.
 */
export async function issueCustomerSpecificNewsletterPromotion(
  stripe: Stripe,
  email: string,
  issuanceSource: NewsletterIssuanceSource,
  options?: IssueCustomerNewsletterPromotionOptions,
): Promise<IssueCustomerNewsletterPromotionResult> {
  const validated = validateRedemptionEmail(email);
  if (!validated.ok) {
    return { status: "skipped", reason: "invalid_email" };
  }

  const hasRedeemed =
    options?.testOverrides?.hasRedeemed ?? hasRedeemedNewsletterPromotion;
  const getIssuanceByEmail =
    options?.testOverrides?.getIssuanceByEmail ??
    getNewsletterPromotionIssuanceByEmail;
  const recordIssuance =
    options?.testOverrides?.recordIssuance ?? recordNewsletterPromotionIssuance;
  const resolveCouponId =
    options?.testOverrides?.resolveCouponId ??
    resolveNewsletterCouponIdForIssuance;

  let redeemed = false;
  try {
    redeemed = await hasRedeemed(validated.email);
  } catch (error) {
    console.error("Newsletter issuance: redemption lookup failed:", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { status: "skipped", reason: "database_unavailable" };
  }

  if (redeemed) {
    return { status: "skipped", reason: "already_redeemed" };
  }

  let existingRow: NewsletterPromotionIssuanceRow | null = null;
  try {
    existingRow = await getIssuanceByEmail(validated.email);
  } catch (error) {
    console.error("Newsletter issuance: issuance lookup failed:", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { status: "skipped", reason: "database_unavailable" };
  }

  if (existingRow) {
    return {
      status: "existing",
      stripePromotionCodeId: existingRow.stripe_promotion_code_id,
      stripeCustomerId: existingRow.stripe_customer_id,
    };
  }

  const couponId = await resolveCouponId(stripe);
  if (!couponId) {
    const pinned = getNewsletterStripeCouponId();
    console.error("Newsletter issuance: newsletter coupon id is not configured.", {
      production: process.env.VERCEL_ENV === "production",
      hasPinnedCoupon: Boolean(pinned),
    });
    return { status: "skipped", reason: "missing_coupon_id" };
  }

  const findActiveUnrestricted =
    options?.testOverrides?.findActiveUnrestrictedGlobal ??
    findActiveUnrestrictedNewsletterPromotionForCoupon;

  let activeUnrestricted: Stripe.PromotionCode | null = null;
  try {
    activeUnrestricted = await findActiveUnrestricted(stripe, couponId);
  } catch (error) {
    logStripeIssuanceError(
      "Newsletter issuance: unrestricted global promotion lookup failed:",
      error,
    );
    return { status: "failed", reason: "stripe_error" };
  }

  if (activeUnrestricted) {
    return issueWhenGlobalNewsletterCodeActive(
      stripe,
      validated.email,
      couponId,
      issuanceSource,
      options,
      recordIssuance,
    );
  }

  let stripeCustomerId: string;
  try {
    stripeCustomerId = await findOrCreateStripeCustomerByEmail(
      stripe,
      validated.email,
    );
  } catch (error) {
    logStripeIssuanceError("Newsletter issuance: Stripe customer error:", error);
    return { status: "failed", reason: "stripe_error" };
  }

  const reconciledAfterCreate = await reconcileCustomerNewsletterPromotionWhenPossible(
    stripe,
    stripeCustomerId,
    couponId,
    validated.email,
    issuanceSource,
    options,
    recordIssuance,
  );
  if (reconciledAfterCreate) {
    return reconciledAfterCreate;
  }

  try {
    existingRow = await getIssuanceByEmail(validated.email);
  } catch {
    return { status: "skipped", reason: "database_unavailable" };
  }
  if (existingRow) {
    return {
      status: "existing",
      stripePromotionCodeId: existingRow.stripe_promotion_code_id,
      stripeCustomerId: existingRow.stripe_customer_id,
    };
  }

  let created: Stripe.PromotionCode;
  try {
    created = await stripe.promotionCodes.create(
      buildCustomerSpecificPromotionCodeCreateParams(
        stripeCustomerId,
        couponId,
      ),
    );
  } catch (error) {
    logStripeIssuanceError(
      "Newsletter issuance: Stripe promotion create error:",
      error,
    );
    return { status: "failed", reason: "stripe_error" };
  }

  try {
    await recordIssuance({
      email: validated.email,
      stripeCustomerId,
      stripePromotionCodeId: created.id,
      stripeCouponId: couponId,
      issuanceSource,
      migrationRunId: options?.migrationRunId ?? null,
    });
  } catch (error) {
    console.error(
      "Newsletter issuance: Stripe promo created but database insert failed; retry will reconcile via customer+code lookup.",
      { promotionCodeId: created.id, error: error instanceof Error ? error.message : "unknown" },
    );
    return { status: "failed", reason: "database_error" };
  }

  return {
    status: "issued",
    stripePromotionCodeId: created.id,
    stripeCustomerId,
  };
}

/**
 * Post-signup issuance hook. Never throws; signup must not depend on Stripe/issuance.
 */
export async function attemptNewsletterPromotionIssuanceAfterSignup(
  email: string,
  options?: {
    issueFn?: IssueCustomerNewsletterPromotionFn;
    createStripe?: () => Stripe | null;
  },
): Promise<void> {
  const createStripe =
    options?.createStripe ??
    (() => {
      const secret = process.env.STRIPE_SECRET_KEY?.trim();
      if (!secret) return null;
      return new Stripe(secret);
    });

  const stripe = createStripe();
  if (!stripe) {
    console.warn(
      "Newsletter promotion issuance skipped: STRIPE_SECRET_KEY is not configured.",
    );
    return;
  }

  const issueFn =
    options?.issueFn ?? issueCustomerSpecificNewsletterPromotion;

  try {
    const result = await issueFn(stripe, email, "signup");
    if (result.status === "failed") {
      console.error("Newsletter promotion issuance failed after signup:", {
        reason: result.reason,
      });
      try {
        await recordNewsletterPromotionIssuanceFailure(
          email,
          `signup:${result.reason}`,
        );
      } catch {
        // No issuance row yet; failure is logged above only.
      }
    } else if (
      result.status === "skipped" &&
      result.reason === "missing_coupon_id"
    ) {
      console.error(
        "Newsletter promotion issuance skipped: configure NEWSLETTER_STRIPE_COUPON_ID.",
      );
    } else if (
      result.status === "skipped" &&
      result.reason === "deferred_global_code_active"
    ) {
      console.info(
        "Newsletter promotion issuance deferred: active unrestricted global newsletter code.",
      );
    }
  } catch (error) {
    console.error("Newsletter promotion issuance unexpected error after signup:", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
