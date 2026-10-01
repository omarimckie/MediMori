import { createHash } from "node:crypto";
import type { Lead } from "./leads-store";
import { validateRedemptionEmail } from "./newsletter-promotion-redemption";
import {
  isUnrestrictedNewsletterPromotionCode,
  newsletterPromotionCodeMatchesCoupon,
  summarizeNewsletterPromotionCodeState,
  type GlobalNewsletterPromotionState,
} from "./stripe-discount";
import { getNewsletterDiscountCode } from "./newsletter-constants";
import type Stripe from "stripe";

export type SubscriberStripeCustomerMatch = "none" | "one" | "multiple";

export type MigrationSubscriberCategory =
  | "invalid_email"
  | "already_redeemed"
  | "has_issuance_record"
  | "needs_migration";

export type ClassifiedMigrationSubscriber = {
  normalizedEmail: string;
  category: MigrationSubscriberCategory;
  stripeCustomerMatch?: SubscriberStripeCustomerMatch;
  stripeCustomerIds?: string[];
  customerSpecificNewsletterPromoIds?: string[];
};

export type MigrationPreflightAnomaly = {
  code: string;
  emailRef: string;
  detail: string;
};

export type MigrationPreflightCounts = {
  blobLeadRecordsRead: number;
  uniqueNormalizedSubscribers: number;
  invalidRecords: number;
  alreadyRedeemed: number;
  existingIssuanceRecords: number;
  subscribersNeedingMigration: number;
  needingStripeCustomer: number;
  exactlyOneStripeCustomer: number;
  multipleStripeCustomerMatches: number;
  existingCustomerSpecificNewsletterPromotion: number;
  anomalies: number;
  errors: number;
};

export type MigrationPreflightReport = {
  generatedAt: string;
  newsletterDiscountCode: string;
  globalPromotionState: GlobalNewsletterPromotionState;
  counts: MigrationPreflightCounts;
  anomalies: MigrationPreflightAnomaly[];
  errors: string[];
};

export type MigrationPreflightDeps = {
  leads: Lead[];
  redeemedEmails: Set<string>;
  issuanceEmails: Set<string>;
  newsletterCouponId: string | null;
  stripe: Stripe | null;
  searchCustomersByEmail: (
    stripe: Stripe,
    email: string,
  ) => Promise<Stripe.Customer[]>;
  listCustomerNewsletterPromotions: (
    stripe: Stripe,
    customerId: string,
    couponId: string,
  ) => Promise<Stripe.PromotionCode[]>;
  listActiveNewsletterPromotions: (stripe: Stripe) => Promise<Stripe.PromotionCode[]>;
};

/** Mask email for anomaly reports (no full addresses in aggregate output). */
export function maskEmailForMigrationReport(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0) {
    const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
    return `ref:${digest}`;
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const localMask =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${localMask}@${domain}#${digest}`;
}

export function collectUniqueNormalizedSubscriberEmails(
  leads: Lead[],
): {
  blobLeadRecordsRead: number;
  uniqueNormalizedSubscribers: string[];
  invalidRecords: number;
} {
  const blobLeadRecordsRead = leads.length;
  const seen = new Set<string>();
  const uniqueNormalizedSubscribers: string[] = [];
  let invalidRecords = 0;

  for (const lead of leads) {
    if (!lead || typeof lead.email !== "string") {
      invalidRecords += 1;
      continue;
    }
    const validated = validateRedemptionEmail(lead.email);
    if (!validated.ok) {
      invalidRecords += 1;
      continue;
    }
    if (seen.has(validated.email)) continue;
    seen.add(validated.email);
    uniqueNormalizedSubscribers.push(validated.email);
  }

  return {
    blobLeadRecordsRead,
    uniqueNormalizedSubscribers,
    invalidRecords,
  };
}

function classifySubscriberCategory(
  email: string,
  redeemedEmails: Set<string>,
  issuanceEmails: Set<string>,
): MigrationSubscriberCategory {
  const validated = validateRedemptionEmail(email);
  if (!validated.ok) return "invalid_email";
  if (redeemedEmails.has(validated.email)) return "already_redeemed";
  if (issuanceEmails.has(validated.email)) return "has_issuance_record";
  return "needs_migration";
}

export async function runNewsletterMigrationPreflight(
  deps: MigrationPreflightDeps,
): Promise<MigrationPreflightReport> {
  const errors: string[] = [];
  const anomalies: MigrationPreflightAnomaly[] = [];
  const {
    blobLeadRecordsRead,
    uniqueNormalizedSubscribers,
    invalidRecords,
  } = collectUniqueNormalizedSubscriberEmails(deps.leads);

  let alreadyRedeemed = 0;
  let existingIssuanceRecords = 0;
  let subscribersNeedingMigration = 0;
  let needingStripeCustomer = 0;
  let exactlyOneStripeCustomer = 0;
  let multipleStripeCustomerMatches = 0;
  let existingCustomerSpecificNewsletterPromotion = 0;

  const couponId = deps.newsletterCouponId;
  let globalPromotionState: GlobalNewsletterPromotionState = {
    hasActiveUnrestricted: false,
    activeUnrestrictedPromotionCodeIds: [],
    activeCustomerRestrictedPromotionCodeCount: 0,
  };

  if (deps.stripe && couponId) {
    try {
      globalPromotionState = await summarizeNewsletterPromotionCodeState(
        deps.stripe,
        couponId,
      );
    } catch (error) {
      errors.push(
        `Global promotion state lookup failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  } else if (!couponId) {
    errors.push("NEWSLETTER_STRIPE_COUPON_ID is not configured.");
  } else {
    errors.push("Stripe client is not configured.");
  }

  for (const email of uniqueNormalizedSubscribers) {
    const category = classifySubscriberCategory(
      email,
      deps.redeemedEmails,
      deps.issuanceEmails,
    );

    if (category === "invalid_email") continue;
    if (category === "already_redeemed") {
      alreadyRedeemed += 1;
      continue;
    }
    if (category === "has_issuance_record") {
      existingIssuanceRecords += 1;
      continue;
    }

    subscribersNeedingMigration += 1;

    if (!deps.stripe || !couponId) {
      needingStripeCustomer += 1;
      continue;
    }

    let customers: Stripe.Customer[] = [];
    try {
      customers = await deps.searchCustomersByEmail(deps.stripe, email);
    } catch (error) {
      errors.push(
        `Stripe customer search failed for ${maskEmailForMigrationReport(email)}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      continue;
    }

    if (customers.length === 0) {
      needingStripeCustomer += 1;
      continue;
    }

    if (customers.length === 1) {
      exactlyOneStripeCustomer += 1;
    } else {
      multipleStripeCustomerMatches += 1;
      anomalies.push({
        code: "multiple_stripe_customers",
        emailRef: maskEmailForMigrationReport(email),
        detail: `${customers.length} Stripe customers share this email.`,
      });
    }

    for (const customer of customers) {
      if (!customer.id) continue;
      let promos: Stripe.PromotionCode[] = [];
      try {
        promos = await deps.listCustomerNewsletterPromotions(
          deps.stripe,
          customer.id,
          couponId,
        );
      } catch (error) {
        errors.push(
          `Stripe promotion list failed for ${maskEmailForMigrationReport(email)}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        continue;
      }

      const customerSpecific = promos.filter(
        (promotionCode) =>
          !isUnrestrictedNewsletterPromotionCode(promotionCode) &&
          newsletterPromotionCodeMatchesCoupon(promotionCode, couponId),
      );

      if (customerSpecific.length > 0) {
        existingCustomerSpecificNewsletterPromotion += 1;
        anomalies.push({
          code: "existing_customer_specific_promotion",
          emailRef: maskEmailForMigrationReport(email),
          detail: `Found ${customerSpecific.length} customer-specific ${getNewsletterDiscountCode()} promotion(s) for customer ${customer.id}.`,
        });
      }
    }
  }

  if (deps.stripe && couponId) {
    try {
      const active = await deps.listActiveNewsletterPromotions(deps.stripe);
      const unrestrictedCount = active.filter(
        (promotionCode) =>
          isUnrestrictedNewsletterPromotionCode(promotionCode) &&
          newsletterPromotionCodeMatchesCoupon(promotionCode, couponId),
      ).length;
      if (unrestrictedCount > 1) {
        anomalies.push({
          code: "multiple_active_unrestricted_codes",
          emailRef: "global",
          detail: `${unrestrictedCount} active unrestricted ${getNewsletterDiscountCode()} codes for the newsletter coupon.`,
        });
      }
    } catch (error) {
      errors.push(
        `Active newsletter promotion listing failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  const counts: MigrationPreflightCounts = {
    blobLeadRecordsRead,
    uniqueNormalizedSubscribers: uniqueNormalizedSubscribers.length,
    invalidRecords,
    alreadyRedeemed,
    existingIssuanceRecords,
    subscribersNeedingMigration,
    needingStripeCustomer,
    exactlyOneStripeCustomer,
    multipleStripeCustomerMatches,
    existingCustomerSpecificNewsletterPromotion,
    anomalies: anomalies.length,
    errors: errors.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    newsletterDiscountCode: getNewsletterDiscountCode(),
    globalPromotionState,
    counts,
    anomalies,
    errors,
  };
}

export function formatMigrationPreflightReport(report: MigrationPreflightReport): string {
  const lines: string[] = [
    "Newsletter migration preflight (read-only)",
    `Generated: ${report.generatedAt}`,
    `Newsletter code: ${report.newsletterDiscountCode}`,
    "",
    "Global promotion state:",
    `  active unrestricted present: ${report.globalPromotionState.hasActiveUnrestricted}`,
    `  active unrestricted promotion ids: ${report.globalPromotionState.activeUnrestrictedPromotionCodeIds.join(", ") || "(none)"}`,
    `  active customer-restricted count (newsletter coupon): ${report.globalPromotionState.activeCustomerRestrictedPromotionCodeCount}`,
    "",
    "Counts:",
    `  blob lead records read: ${report.counts.blobLeadRecordsRead}`,
    `  unique normalized subscribers: ${report.counts.uniqueNormalizedSubscribers}`,
    `  invalid records: ${report.counts.invalidRecords}`,
    `  already redeemed: ${report.counts.alreadyRedeemed}`,
    `  existing issuance records: ${report.counts.existingIssuanceRecords}`,
    `  subscribers needing migration: ${report.counts.subscribersNeedingMigration}`,
    `  needing a Stripe customer: ${report.counts.needingStripeCustomer}`,
    `  exactly one Stripe customer: ${report.counts.exactlyOneStripeCustomer}`,
    `  multiple Stripe customer matches: ${report.counts.multipleStripeCustomerMatches}`,
    `  existing customer-specific newsletter promotion found: ${report.counts.existingCustomerSpecificNewsletterPromotion}`,
    `  anomalies: ${report.counts.anomalies}`,
    `  errors: ${report.counts.errors}`,
  ];

  if (report.anomalies.length > 0) {
    lines.push("", "Anomalies:");
    for (const anomaly of report.anomalies) {
      lines.push(`  - [${anomaly.code}] ${anomaly.emailRef}: ${anomaly.detail}`);
    }
  }

  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of report.errors) {
      lines.push(`  - ${error}`);
    }
  }

  return lines.join("\n");
}
