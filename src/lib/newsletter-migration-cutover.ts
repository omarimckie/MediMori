import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import type { Lead } from "./leads-store";
import { validateRedemptionEmail } from "./newsletter-promotion-redemption";
import {
  buildCustomerSpecificPromotionCodeCreateParams,
  findCustomerSpecificNewsletterPromotionCode,
  getNewsletterPromotionIssuanceByEmail,
  listCustomerSpecificNewsletterPromotionCodes,
  recordNewsletterPromotionIssuance,
} from "./newsletter-promotion-issuance";
import {
  collectUniqueNormalizedSubscriberEmails,
  maskEmailForMigrationReport,
  type MigrationPreflightReport,
} from "./newsletter-migration-preflight";
import { getNewsletterDiscountCode } from "./newsletter-constants";
import {
  findActiveUnrestrictedNewsletterPromotionForCoupon,
  getNewsletterStripeCouponId,
  isUnrestrictedNewsletterPromotionCode,
  listActiveNewsletterPromotionCodes,
  newsletterPromotionCodeMatchesCoupon,
} from "./stripe-discount";
import { stripeErrorDiagnostics } from "./stripe-error-diagnostics";

/** Verified production pre-cutover snapshot (2026-10-01 preflight). */
export const DEFAULT_PRODUCTION_CUTOVER_EXPECTED = {
  globalPromotionId: "promo_1U4q3uGmFetwj9NcROsrrqWM",
  eligibleNormalizedSubscriberCount: 2,
  expectedRedemptionCount: 0,
  expectedIssuanceRecordCount: 0,
  expectedCustomerSpecificPromotionCount: 0,
  expectedMultipleStripeCustomerMatches: 0,
  expectedSubscribersNeedingMigration: 2,
} as const;

export type NewsletterCutoverExpectedState =
  typeof DEFAULT_PRODUCTION_CUTOVER_EXPECTED;

export type CutoverPreconditionFailure = {
  code: string;
  message: string;
};

export type CutoverLifecyclePhase =
  | "pre_cutover_pristine"
  | "already_complete"
  | "partial_or_unexpected";

export function createNewsletterMigrationRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const suffix = randomBytes(4).toString("hex");
  return `newsletter-cutover-${stamp}-${suffix}`;
}

export function listCutoverEligibleSubscriberEmails(
  leads: Lead[],
  redeemedEmails: Set<string>,
  issuanceEmails: Set<string>,
): string[] {
  const { uniqueNormalizedSubscribers } =
    collectUniqueNormalizedSubscriberEmails(leads);
  const eligible: string[] = [];
  for (const email of uniqueNormalizedSubscribers) {
    const validated = validateRedemptionEmail(email);
    if (!validated.ok) continue;
    if (redeemedEmails.has(validated.email)) continue;
    if (issuanceEmails.has(validated.email)) continue;
    eligible.push(validated.email);
  }
  return eligible;
}

export function detectCutoverLifecyclePhase(
  report: MigrationPreflightReport,
  expected: NewsletterCutoverExpectedState,
): CutoverLifecyclePhase {
  const pristine =
    report.counts.uniqueNormalizedSubscribers ===
      expected.eligibleNormalizedSubscriberCount &&
    report.counts.alreadyRedeemed === expected.expectedRedemptionCount &&
    report.counts.existingIssuanceRecords ===
      expected.expectedIssuanceRecordCount &&
    report.counts.subscribersNeedingMigration ===
      expected.expectedSubscribersNeedingMigration &&
    report.counts.existingCustomerSpecificNewsletterPromotion ===
      expected.expectedCustomerSpecificPromotionCount &&
    report.counts.multipleStripeCustomerMatches ===
      expected.expectedMultipleStripeCustomerMatches &&
    report.counts.anomalies === 0 &&
    report.counts.errors === 0 &&
    report.globalPromotionState.hasActiveUnrestricted &&
    report.globalPromotionState.activeUnrestrictedPromotionCodeIds.includes(
      expected.globalPromotionId,
    );

  if (pristine) {
    return "pre_cutover_pristine";
  }

  const complete =
    !report.globalPromotionState.hasActiveUnrestricted &&
    report.globalPromotionState.activeCustomerRestrictedPromotionCodeCount ===
      expected.eligibleNormalizedSubscriberCount &&
    report.counts.existingIssuanceRecords ===
      expected.eligibleNormalizedSubscriberCount &&
    report.counts.subscribersNeedingMigration === 0 &&
    report.counts.alreadyRedeemed === expected.expectedRedemptionCount &&
    report.counts.multipleStripeCustomerMatches === 0 &&
    report.counts.anomalies === 0 &&
    report.counts.errors === 0;

  if (complete) {
    return "already_complete";
  }

  return "partial_or_unexpected";
}

export async function validateNewsletterCutoverPreconditions(
  report: MigrationPreflightReport,
  expected: NewsletterCutoverExpectedState,
  stripe: Stripe | null,
  newsletterCouponId: string | null,
): Promise<CutoverPreconditionFailure[]> {
  const failures: CutoverPreconditionFailure[] = [];
  const phase = detectCutoverLifecyclePhase(report, expected);

  if (phase === "already_complete") {
    return failures;
  }

  if (phase === "partial_or_unexpected") {
    failures.push({
      code: "unexpected_cutover_state",
      message:
        "Live state does not match pristine pre-cutover or completed migration expectations. Stop and reconcile manually.",
    });
  }

  if (!newsletterCouponId) {
    failures.push({
      code: "missing_coupon_id",
      message: "NEWSLETTER_STRIPE_COUPON_ID is not configured.",
    });
  }

  if (!stripe) {
    failures.push({
      code: "stripe_not_configured",
      message: "STRIPE_SECRET_KEY is not configured.",
    });
  }

  if (report.counts.errors > 0) {
    failures.push({
      code: "preflight_errors",
      message: `Preflight reported ${report.counts.errors} error(s).`,
    });
  }

  if (report.counts.anomalies > 0) {
    failures.push({
      code: "preflight_anomalies",
      message: `Preflight reported ${report.counts.anomalies} anomaly/anomalies.`,
    });
  }

  if (
    report.counts.uniqueNormalizedSubscribers !==
    expected.eligibleNormalizedSubscriberCount
  ) {
    failures.push({
      code: "subscriber_count_changed",
      message: `Expected ${expected.eligibleNormalizedSubscriberCount} unique normalized subscribers, found ${report.counts.uniqueNormalizedSubscribers}.`,
    });
  }

  if (report.counts.alreadyRedeemed !== expected.expectedRedemptionCount) {
    failures.push({
      code: "redemption_count_changed",
      message: `Expected ${expected.expectedRedemptionCount} redemptions, found ${report.counts.alreadyRedeemed}.`,
    });
  }

  if (
    report.counts.existingIssuanceRecords !==
    expected.expectedIssuanceRecordCount
  ) {
    failures.push({
      code: "issuance_count_changed",
      message: `Expected ${expected.expectedIssuanceRecordCount} issuance records, found ${report.counts.existingIssuanceRecords}.`,
    });
  }

  if (
    report.counts.existingCustomerSpecificNewsletterPromotion !==
    expected.expectedCustomerSpecificPromotionCount
  ) {
    failures.push({
      code: "customer_specific_promotions_present",
      message: `Expected ${expected.expectedCustomerSpecificPromotionCount} customer-specific newsletter promotions, found ${report.counts.existingCustomerSpecificNewsletterPromotion}.`,
    });
  }

  if (
    report.counts.multipleStripeCustomerMatches !==
    expected.expectedMultipleStripeCustomerMatches
  ) {
    failures.push({
      code: "multiple_stripe_customers",
      message: `Expected ${expected.expectedMultipleStripeCustomerMatches} multiple-customer matches, found ${report.counts.multipleStripeCustomerMatches}.`,
    });
  }

  if (phase !== "pre_cutover_pristine") {
    return failures;
  }

  if (!report.globalPromotionState.hasActiveUnrestricted) {
    failures.push({
      code: "global_promotion_inactive",
      message: "Global TWILIGHTFEATHER10 is not active (no active unrestricted promotion).",
    });
  }

  const unrestrictedIds =
    report.globalPromotionState.activeUnrestrictedPromotionCodeIds;
  if (!unrestrictedIds.includes(expected.globalPromotionId)) {
    failures.push({
      code: "global_promotion_id_mismatch",
      message: `Expected global promotion ${expected.globalPromotionId}, active unrestricted ids: ${unrestrictedIds.join(", ") || "(none)"}.`,
    });
  }

  if (stripe && newsletterCouponId) {
    try {
      const liveGlobal = await findActiveUnrestrictedNewsletterPromotionForCoupon(
        stripe,
        newsletterCouponId,
      );
      if (!liveGlobal?.id) {
        const activeCodes = await listActiveNewsletterPromotionCodes(stripe);
        const matchingActive = activeCodes.filter((promotionCode) =>
          newsletterPromotionCodeMatchesCoupon(promotionCode, newsletterCouponId),
        );
        const restrictedActive = matchingActive.filter(
          (promotionCode) => !isUnrestrictedNewsletterPromotionCode(promotionCode),
        );
        if (restrictedActive.length > 0 && matchingActive.every((p) => !isUnrestrictedNewsletterPromotionCode(p))) {
          failures.push({
            code: "global_promotion_customer_restricted",
            message: "Active newsletter promotion is customer-restricted; expected unrestricted global TWILIGHTFEATHER10.",
          });
        } else {
          failures.push({
            code: "global_promotion_missing",
            message: "Active unrestricted global newsletter promotion not found in Stripe.",
          });
        }
      } else {
        if (liveGlobal.id !== expected.globalPromotionId) {
          failures.push({
            code: "stale_global_promotion_id",
            message: `Stripe active unrestricted promotion is ${liveGlobal.id}, expected ${expected.globalPromotionId}.`,
          });
        }
        if (!liveGlobal.active) {
          failures.push({
            code: "global_promotion_inactive",
            message: "Global newsletter promotion is not active in Stripe.",
          });
        }
        if (!isUnrestrictedNewsletterPromotionCode(liveGlobal)) {
          failures.push({
            code: "global_promotion_customer_restricted",
            message: "Global newsletter promotion is customer-restricted, not unrestricted.",
          });
        }
        if (
          !newsletterPromotionCodeMatchesCoupon(liveGlobal, newsletterCouponId)
        ) {
          failures.push({
            code: "global_promotion_coupon_mismatch",
            message: "Global newsletter promotion does not use the configured newsletter coupon.",
          });
        }
      }
    } catch (error) {
      failures.push({
        code: "global_promotion_lookup_failed",
        message: `Stripe global promotion lookup failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      });
    }
  }

  return failures;
}

export type PreparedCutoverCustomer = {
  normalizedEmail: string;
  emailRef: string;
  stripeCustomerId: string;
  created: boolean;
};

export type PrepareCutoverCustomersResult =
  | { ok: true; customers: PreparedCutoverCustomer[] }
  | {
      ok: false;
      reason:
        | "ambiguous_stripe_customers"
        | "stripe_error"
        | "customer_create_failed";
      emailRef?: string;
      detail?: string;
    };

export async function prepareCutoverStripeCustomers(
  stripe: Stripe,
  emails: string[],
  options: {
    apply: boolean;
    searchCustomersByEmail: (
      stripe: Stripe,
      email: string,
    ) => Promise<Stripe.Customer[]>;
    createCustomerByEmail: (stripe: Stripe, email: string) => Promise<string>;
  },
): Promise<PrepareCutoverCustomersResult> {
  const customers: PreparedCutoverCustomer[] = [];

  for (const email of emails) {
    const emailRef = maskEmailForMigrationReport(email);
    let matches: Stripe.Customer[] = [];
    try {
      matches = await options.searchCustomersByEmail(stripe, email);
    } catch (error) {
      return {
        ok: false,
        reason: "stripe_error",
        emailRef,
        detail: stripeErrorDiagnostics(error).message,
      };
    }

    if (matches.length > 1) {
      return {
        ok: false,
        reason: "ambiguous_stripe_customers",
        emailRef,
        detail: `${matches.length} Stripe customers match this email.`,
      };
    }

    if (matches.length === 1 && matches[0].id) {
      customers.push({
        normalizedEmail: email,
        emailRef,
        stripeCustomerId: matches[0].id,
        created: false,
      });
      continue;
    }

    if (!options.apply) {
      customers.push({
        normalizedEmail: email,
        emailRef,
        stripeCustomerId: "(would-create)",
        created: true,
      });
      continue;
    }

    try {
      const createdId = await options.createCustomerByEmail(stripe, email);
      customers.push({
        normalizedEmail: email,
        emailRef,
        stripeCustomerId: createdId,
        created: true,
      });
    } catch (error) {
      return {
        ok: false,
        reason: "customer_create_failed",
        emailRef,
        detail: stripeErrorDiagnostics(error).message,
      };
    }
  }

  return { ok: true, customers };
}

export type CutoverPromotionCreateResult =
  | {
      ok: true;
      stripePromotionCodeId: string;
      recordedIssuance: boolean;
    }
  | {
      ok: false;
      reason: "stripe_error" | "database_error" | "ambiguous_existing";
      detail?: string;
    };

export async function createCutoverCustomerPromotionAndRecordIssuance(
  stripe: Stripe,
  input: {
    email: string;
    stripeCustomerId: string;
    couponId: string;
    migrationRunId: string;
  },
  options?: {
    recordIssuance?: typeof recordNewsletterPromotionIssuance;
    getIssuanceByEmail?: typeof getNewsletterPromotionIssuanceByEmail;
  },
): Promise<CutoverPromotionCreateResult> {
  const recordIssuance = options?.recordIssuance ?? recordNewsletterPromotionIssuance;
  const getIssuanceByEmail =
    options?.getIssuanceByEmail ?? getNewsletterPromotionIssuanceByEmail;

  const existingIssuance = await getIssuanceByEmail(input.email);
  if (existingIssuance) {
    return {
      ok: true,
      stripePromotionCodeId: existingIssuance.stripe_promotion_code_id,
      recordedIssuance: false,
    };
  }

  const existingPromos = await listCustomerSpecificNewsletterPromotionCodes(
    stripe,
    input.stripeCustomerId,
    input.couponId,
  );
  if (existingPromos.length > 1) {
    return { ok: false, reason: "ambiguous_existing" };
  }

  let promotionCodeId: string;
  if (existingPromos.length === 1 && existingPromos[0].id) {
    promotionCodeId = existingPromos[0].id;
  } else {
    let created: Stripe.PromotionCode;
    try {
      created = await stripe.promotionCodes.create(
        buildCustomerSpecificPromotionCodeCreateParams(
          input.stripeCustomerId,
          input.couponId,
          { migrationRunId: input.migrationRunId },
        ),
      );
    } catch (error) {
      return {
        ok: false,
        reason: "stripe_error",
        detail: stripeErrorDiagnostics(error).message,
      };
    }
    if (!created.id) {
      return {
        ok: false,
        reason: "stripe_error",
        detail: "Stripe promotion create returned no id.",
      };
    }
    promotionCodeId = created.id;

    const confirmed = await findCustomerSpecificNewsletterPromotionCode(
      stripe,
      input.stripeCustomerId,
      input.couponId,
    );
    if (!confirmed?.id || confirmed.id !== promotionCodeId) {
      return {
        ok: false,
        reason: "stripe_error",
        detail: "Customer-specific promotion could not be confirmed after create.",
      };
    }
  }

  try {
    await recordIssuance({
      email: input.email,
      stripeCustomerId: input.stripeCustomerId,
      stripePromotionCodeId: promotionCodeId,
      stripeCouponId: input.couponId,
      issuanceSource: "migration",
      migrationRunId: input.migrationRunId,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "database_error",
      detail: error instanceof Error ? error.message : "unknown",
    };
  }

  return {
    ok: true,
    stripePromotionCodeId: promotionCodeId,
    recordedIssuance: true,
  };
}

export type GlobalPromotionToggleResult =
  | { ok: true; promotionId: string; active: boolean }
  | { ok: false; detail: string };

export async function setGlobalNewsletterPromotionActive(
  stripe: Stripe,
  promotionId: string,
  active: boolean,
): Promise<GlobalPromotionToggleResult> {
  try {
    const updated = await stripe.promotionCodes.update(promotionId, { active });
    return { ok: true, promotionId: updated.id, active: updated.active };
  } catch (error) {
    return {
      ok: false,
      detail: stripeErrorDiagnostics(error).message,
    };
  }
}

export type PostCutoverVerification = {
  ok: boolean;
  checks: { code: string; ok: boolean; detail: string }[];
};

export async function verifyPostCutoverState(
  stripe: Stripe,
  couponId: string,
  expectedSubscriberCount: number,
  redeemedCount: number,
  issuanceRows: {
    email: string;
    stripe_customer_id: string;
    stripe_promotion_code_id: string;
  }[],
): Promise<PostCutoverVerification> {
  const checks: PostCutoverVerification["checks"] = [];
  const code = getNewsletterDiscountCode();

  const active = await listActiveNewsletterPromotionCodes(stripe);
  const matching = active.filter((p) =>
    newsletterPromotionCodeMatchesCoupon(p, couponId),
  );
  const unrestrictedActive = matching.filter(isUnrestrictedNewsletterPromotionCode);
  const customerRestrictedActive = matching.filter(
    (p) => !isUnrestrictedNewsletterPromotionCode(p),
  );

  checks.push({
    code: "global_inactive",
    ok: unrestrictedActive.length === 0,
    detail: `active unrestricted ${code} count: ${unrestrictedActive.length}`,
  });

  checks.push({
    code: "customer_restricted_count",
    ok: customerRestrictedActive.length === expectedSubscriberCount,
    detail: `active customer-restricted count: ${customerRestrictedActive.length}`,
  });

  checks.push({
    code: "issuance_row_count",
    ok: issuanceRows.length === expectedSubscriberCount,
    detail: `issuance rows: ${issuanceRows.length}`,
  });

  checks.push({
    code: "redemption_count",
    ok: redeemedCount === 0,
    detail: `redemptions: ${redeemedCount}`,
  });

  for (const row of issuanceRows) {
    const promo = customerRestrictedActive.find((p) => p.id === row.stripe_promotion_code_id);
    checks.push({
      code: `issuance_promo_active_${maskEmailForMigrationReport(row.email)}`,
      ok: Boolean(promo?.active),
      detail: promo
        ? `promotion ${row.stripe_promotion_code_id} active for customer ${row.stripe_customer_id}`
        : `issuance promo ${row.stripe_promotion_code_id} not found among active customer-restricted codes`,
    });
    if (promo) {
      checks.push({
        code: `promo_max_redemptions_${row.stripe_promotion_code_id}`,
        ok: promo.max_redemptions === 1,
        detail: `max_redemptions=${promo.max_redemptions ?? "unset"}`,
      });
      const customerId =
        typeof promo.customer === "string" ? promo.customer : promo.customer?.id;
      checks.push({
        code: `promo_customer_match_${row.stripe_promotion_code_id}`,
        ok: customerId === row.stripe_customer_id,
        detail: `promo customer ${customerId ?? "none"} vs issuance ${row.stripe_customer_id}`,
      });
    }
  }

  const duplicateCustomers = new Set<string>();
  const seenCustomers = new Set<string>();
  for (const promo of customerRestrictedActive) {
    const customerId =
      typeof promo.customer === "string" ? promo.customer : promo.customer?.id;
    if (!customerId) continue;
    if (seenCustomers.has(customerId)) duplicateCustomers.add(customerId);
    seenCustomers.add(customerId);
  }
  checks.push({
    code: "no_duplicate_customer_promos",
    ok: duplicateCustomers.size === 0,
    detail: duplicateCustomers.size
      ? `duplicate customer ids: ${[...duplicateCustomers].join(", ")}`
      : "no duplicate customer-restricted promos",
  });

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

export type NewsletterMigrationCutoverReport = {
  mode: "dry_run" | "apply";
  migrationRunId: string;
  lifecyclePhase: CutoverLifecyclePhase;
  preflight: MigrationPreflightReport;
  preconditionFailures: CutoverPreconditionFailure[];
  aborted: boolean;
  abortReason?: string;
  preparedCustomers?: PreparedCutoverCustomer[];
  globalDeactivated?: boolean;
  globalReactivationAttempted?: boolean;
  globalReactivationSucceeded?: boolean;
  createdPromotionIds: string[];
  issuanceRecordedFor: string[];
  partialFailureDetail?: string;
  postCutoverVerification?: PostCutoverVerification;
};

export type NewsletterMigrationCutoverDeps = {
  apply: boolean;
  expected: NewsletterCutoverExpectedState;
  preflightReport: MigrationPreflightReport;
  stripe: Stripe | null;
  newsletterCouponId: string | null;
  eligibleEmails: string[];
  redeemedCount: number;
  searchCustomersByEmail: (
    stripe: Stripe,
    email: string,
  ) => Promise<Stripe.Customer[]>;
  createCustomerByEmail: (stripe: Stripe, email: string) => Promise<string>;
  listAllIssuanceRows: () => Promise<
    {
      email: string;
      stripe_customer_id: string;
      stripe_promotion_code_id: string;
      migration_run_id: string | null;
    }[]
  >;
  recordIssuance?: typeof recordNewsletterPromotionIssuance;
  getIssuanceByEmail?: typeof getNewsletterPromotionIssuanceByEmail;
  migrationRunId?: string;
  now?: Date;
};

export async function runNewsletterMigrationCutover(
  deps: NewsletterMigrationCutoverDeps,
): Promise<NewsletterMigrationCutoverReport> {
  const migrationRunId =
    deps.migrationRunId ?? createNewsletterMigrationRunId(deps.now);
  const mode = deps.apply ? "apply" : "dry_run";
  const lifecyclePhase = detectCutoverLifecyclePhase(
    deps.preflightReport,
    deps.expected,
  );

  const report: NewsletterMigrationCutoverReport = {
    mode,
    migrationRunId,
    lifecyclePhase,
    preflight: deps.preflightReport,
    preconditionFailures: [],
    aborted: false,
    createdPromotionIds: [],
    issuanceRecordedFor: [],
  };

  if (lifecyclePhase === "already_complete") {
    if (deps.stripe && deps.newsletterCouponId) {
      const rows = await deps.listAllIssuanceRows();
      report.postCutoverVerification = await verifyPostCutoverState(
        deps.stripe,
        deps.newsletterCouponId,
        deps.expected.eligibleNormalizedSubscriberCount,
        deps.redeemedCount,
        rows,
      );
    }
    return report;
  }

  report.preconditionFailures = await validateNewsletterCutoverPreconditions(
    deps.preflightReport,
    deps.expected,
    deps.stripe,
    deps.newsletterCouponId,
  );

  if (report.preconditionFailures.length > 0) {
    report.aborted = true;
    report.abortReason = "preconditions_failed";
    return report;
  }

  if (!deps.stripe || !deps.newsletterCouponId) {
    report.aborted = true;
    report.abortReason = "missing_runtime_config";
    return report;
  }

  const customerPrep = await prepareCutoverStripeCustomers(
    deps.stripe,
    deps.eligibleEmails,
    {
      apply: deps.apply,
      searchCustomersByEmail: deps.searchCustomersByEmail,
      createCustomerByEmail: deps.createCustomerByEmail,
    },
  );

  if (!customerPrep.ok) {
    report.aborted = true;
    report.abortReason = customerPrep.reason;
    report.partialFailureDetail = customerPrep.detail;
    return report;
  }

  report.preparedCustomers = customerPrep.customers;

  if (!deps.apply) {
    return report;
  }

  const globalId = deps.expected.globalPromotionId;
  const deactivate = await setGlobalNewsletterPromotionActive(
    deps.stripe,
    globalId,
    false,
  );
  if (!deactivate.ok) {
    report.aborted = true;
    report.abortReason = "global_deactivation_failed";
    report.partialFailureDetail = deactivate.detail;
    return report;
  }
  report.globalDeactivated = true;

  const createdBeforeFailure: string[] = [];

  for (const prepared of customerPrep.customers) {
    const result = await createCutoverCustomerPromotionAndRecordIssuance(
      deps.stripe,
      {
        email: prepared.normalizedEmail,
        stripeCustomerId: prepared.stripeCustomerId,
        couponId: deps.newsletterCouponId,
        migrationRunId,
      },
      {
        recordIssuance: deps.recordIssuance,
        getIssuanceByEmail: deps.getIssuanceByEmail,
      },
    );

    if (!result.ok) {
      report.aborted = true;
      report.abortReason = "promotion_create_failed";
      report.partialFailureDetail = `${prepared.emailRef}: ${result.reason}${result.detail ? ` — ${result.detail}` : ""}`;
      report.createdPromotionIds = [...createdBeforeFailure];

      report.globalReactivationAttempted = true;
      const restore = await setGlobalNewsletterPromotionActive(
        deps.stripe,
        globalId,
        true,
      );
      report.globalReactivationSucceeded = restore.ok;
      if (!restore.ok) {
        report.partialFailureDetail += ` | global reactivation failed: ${restore.detail}`;
      }
      return report;
    }

    createdBeforeFailure.push(result.stripePromotionCodeId);
    report.createdPromotionIds.push(result.stripePromotionCodeId);
    if (result.recordedIssuance) {
      report.issuanceRecordedFor.push(prepared.emailRef);
    }
  }

  const rows = await deps.listAllIssuanceRows();
  report.postCutoverVerification = await verifyPostCutoverState(
    deps.stripe,
    deps.newsletterCouponId,
    deps.expected.eligibleNormalizedSubscriberCount,
    deps.redeemedCount,
    rows,
  );

  return report;
}

export function formatNewsletterMigrationRollbackProcedure(): string {
  return [
    "Newsletter promotion cutover rollback (manual — do not run automatically except partial-failure global restore)",
    "",
    "1. Identify migration run",
    "   - Query newsletter_promotion_issuances WHERE issuance_source = 'migration'.",
    "   - Note migration_run_id and stripe_promotion_code_id per email.",
    "",
    "2. Stripe customer-specific promotions",
    "   - In Stripe Dashboard or API, list promotion codes code=TWILIGHTFEATHER10 with customer set.",
    "   - Leave created customer-specific promos in place unless you have a deterministic need to deactivate them.",
    "   - Do not delete Stripe objects silently from automation.",
    "",
    "3. Restore global TWILIGHTFEATHER10 (if cutover deactivated it)",
    "   - promotionCodes.update('promo_1U4q3uGmFetwj9NcROsrrqWM', { active: true })",
    "   - Verify: one active unrestricted global code on the newsletter coupon; customer-specific codes cannot coexist while global is active.",
    "",
    "4. Neon issuance rows",
    "   - If migration rows were inserted incorrectly, reconcile or remove only after Stripe state is understood.",
    "   - ON CONFLICT (email) means re-running migration should not duplicate rows; manual DELETE requires care.",
    "",
    "5. Re-run read-only preflight",
    "   - npm run newsletter:migration-dry-run",
    "   - Confirm counts and global promotion state before any new apply attempt.",
    "",
    "Partial-failure automatic step: apply path attempts global reactivation when customer-specific creation fails after global deactivation.",
  ].join("\n");
}

export function formatNewsletterMigrationCutoverReport(
  report: NewsletterMigrationCutoverReport,
): string {
  const lines: string[] = [
    `Newsletter migration cutover (${report.mode})`,
    `Migration run id: ${report.migrationRunId}`,
    `Lifecycle phase: ${report.lifecyclePhase}`,
    `Newsletter code: ${getNewsletterDiscountCode()}`,
    `Configured coupon id: ${getNewsletterStripeCouponId() ?? "(missing)"}`,
    "",
  ];

  if (report.preconditionFailures.length > 0) {
    lines.push("Precondition failures (no writes performed):");
    for (const failure of report.preconditionFailures) {
      lines.push(`  - [${failure.code}] ${failure.message}`);
    }
    lines.push("");
  }

  if (report.aborted) {
    lines.push(`Aborted: ${report.abortReason ?? "yes"}`);
    if (report.partialFailureDetail) {
      lines.push(`Detail: ${report.partialFailureDetail}`);
    }
    if (report.globalDeactivated) {
      lines.push(`Global deactivated: yes`);
    }
    if (report.globalReactivationAttempted) {
      lines.push(
        `Global reactivation attempted: yes (success=${report.globalReactivationSucceeded ? "yes" : "no"})`,
      );
    }
    if (report.createdPromotionIds.length > 0) {
      lines.push(
        `Customer-specific promotions created before failure: ${report.createdPromotionIds.join(", ")}`,
      );
    }
    lines.push("");
  }

  if (report.preparedCustomers?.length) {
    lines.push("Prepared Stripe customers:");
    for (const customer of report.preparedCustomers) {
      lines.push(
        `  - ${customer.emailRef}: ${customer.stripeCustomerId}${customer.created ? " (create)" : " (existing)"}`,
      );
    }
    lines.push("");
  }

  if (report.mode === "dry_run" && !report.aborted && report.lifecyclePhase === "pre_cutover_pristine") {
    lines.push("Dry run: would deactivate global promotion, then create customer-specific promotions and issuance rows.");
    lines.push("No Stripe, Neon, or Blob writes were performed.");
    lines.push("");
  }

  if (report.issuanceRecordedFor.length > 0) {
    lines.push(`Issuance recorded for: ${report.issuanceRecordedFor.join(", ")}`);
    lines.push("");
  }

  if (report.postCutoverVerification) {
    lines.push("Post-cutover verification (read-only):");
    lines.push(`  overall ok: ${report.postCutoverVerification.ok}`);
    for (const check of report.postCutoverVerification.checks) {
      lines.push(
        `  - [${check.ok ? "ok" : "FAIL"}] ${check.code}: ${check.detail}`,
      );
    }
  }

  return lines.join("\n");
}
