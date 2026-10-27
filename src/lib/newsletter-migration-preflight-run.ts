import Stripe from "stripe";
import { getSql } from "./db";
import { readStoredLeads } from "./leads-store";
import { listCustomerSpecificNewsletterPromotionCodes } from "./newsletter-promotion-issuance";
import {
  runNewsletterMigrationPreflight,
  type MigrationPreflightReport,
} from "./newsletter-migration-preflight";
import { searchStripeCustomersByEmail } from "./stripe-customer";
import {
  getNewsletterStripeCouponId,
  listActiveNewsletterPromotionCodes,
} from "./stripe-discount";

export async function loadNewsletterRedeemedEmails(): Promise<Set<string>> {
  const sql = getSql();
  const rows = await sql`
    SELECT email FROM newsletter_promotion_redemptions
  `;
  return new Set(
    rows
      .map((row) =>
        typeof row.email === "string" ? row.email.trim().toLowerCase() : "",
      )
      .filter(Boolean),
  );
}

export async function loadNewsletterIssuanceEmails(): Promise<Set<string>> {
  const sql = getSql();
  const rows = await sql`
    SELECT email FROM newsletter_promotion_issuances
  `;
  return new Set(
    rows
      .map((row) =>
        typeof row.email === "string" ? row.email.trim().toLowerCase() : "",
      )
      .filter(Boolean),
  );
}

/**
 * Loads production/runtime data and runs the read-only newsletter migration preflight.
 * Blob SELECT-only, Neon SELECT-only, Stripe search/list only.
 */
export async function executeNewsletterMigrationPreflight(): Promise<MigrationPreflightReport> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
  const couponId = getNewsletterStripeCouponId();

  const leads = await readStoredLeads();
  const redeemedEmails = await loadNewsletterRedeemedEmails();
  const issuanceEmails = await loadNewsletterIssuanceEmails();

  return runNewsletterMigrationPreflight({
    leads,
    redeemedEmails,
    issuanceEmails,
    newsletterCouponId: couponId,
    stripe,
    searchCustomersByEmail: (s, email) =>
      searchStripeCustomersByEmail(s, email, { limit: 20 }),
    listCustomerNewsletterPromotions: (s, customerId, pinnedCouponId) =>
      listCustomerSpecificNewsletterPromotionCodes(
        s,
        customerId,
        pinnedCouponId,
      ),
    listActiveNewsletterPromotions: (s) => listActiveNewsletterPromotionCodes(s),
  });
}

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export type MigrationPreflightAdminDeps = {
  isAdminAuthenticated: () => Promise<boolean>;
  runPreflight: () => Promise<MigrationPreflightReport>;
};

/** Shared admin HTTP behavior for migration preflight (route + tests). */
export async function migrationPreflightAdminResponse(
  deps: MigrationPreflightAdminDeps,
): Promise<Response> {
  if (!(await deps.isAdminAuthenticated())) {
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const report = await deps.runPreflight();
    return Response.json(
      { ok: true, report },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return Response.json(
      { ok: false, error: "Newsletter migration preflight failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
