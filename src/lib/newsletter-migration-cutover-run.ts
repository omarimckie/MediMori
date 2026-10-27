import Stripe from "stripe";
import { getSql } from "./db";
import { readStoredLeads } from "./leads-store";
import {
  DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
  listCutoverEligibleSubscriberEmails,
  runNewsletterMigrationCutover,
  type NewsletterCutoverExpectedState,
  type NewsletterMigrationCutoverReport,
} from "./newsletter-migration-cutover";
import {
  executeNewsletterMigrationPreflight,
  loadNewsletterIssuanceEmails,
  loadNewsletterRedeemedEmails,
} from "./newsletter-migration-preflight-run";
import { findOrCreateStripeCustomerByEmail, searchStripeCustomersByEmail } from "./stripe-customer";
import { getNewsletterStripeCouponId } from "./stripe-discount";

async function loadAllIssuanceRows(): Promise<
  {
    email: string;
    stripe_customer_id: string;
    stripe_promotion_code_id: string;
    migration_run_id: string | null;
  }[]
> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      email,
      stripe_customer_id,
      stripe_promotion_code_id,
      migration_run_id
    FROM newsletter_promotion_issuances
  `;
  return rows.map((row) => ({
    email: String(row.email ?? ""),
    stripe_customer_id: String(row.stripe_customer_id ?? ""),
    stripe_promotion_code_id: String(row.stripe_promotion_code_id ?? ""),
    migration_run_id:
      row.migration_run_id === null || row.migration_run_id === undefined
        ? null
        : String(row.migration_run_id),
  }));
}

export const NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION =
  "EXECUTE_NEWSLETTER_CUTOVER";

export type ExecuteNewsletterMigrationCutoverOptions = {
  apply: boolean;
  expected?: NewsletterCutoverExpectedState;
};

export type MigrationCutoverAdminSafePayload = {
  ok: boolean;
  error?: string;
  errorCode?: string;
  migrationRunId: string;
  mode: "apply";
  lifecyclePhase: NewsletterMigrationCutoverReport["lifecyclePhase"];
  aborted: boolean;
  abortReason?: string;
  aggregate: {
    generatedAt: string;
    newsletterDiscountCode: string;
    counts: NewsletterMigrationCutoverReport["preflight"]["counts"];
    globalPromotionState: NewsletterMigrationCutoverReport["preflight"]["globalPromotionState"];
    preconditionFailures: { code: string; message: string }[];
    preparedCustomers?: {
      emailRef: string;
      stripeCustomerId: string;
      created: boolean;
    }[];
    globalDeactivated?: boolean;
    globalReactivationAttempted?: boolean;
    globalReactivationSucceeded?: boolean;
    createdPromotionIds: string[];
    issuanceRecordedEmailRefs: string[];
    partialFailureDetail?: string;
  };
  postCutoverVerification?: NewsletterMigrationCutoverReport["postCutoverVerification"];
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function migrationCutoverReportSucceeded(
  report: NewsletterMigrationCutoverReport,
): boolean {
  if (report.aborted) return false;
  if (report.postCutoverVerification && !report.postCutoverVerification.ok) {
    return false;
  }
  if (report.lifecyclePhase === "already_complete") {
    return Boolean(report.postCutoverVerification?.ok);
  }
  return Boolean(
    report.mode === "apply" &&
      report.globalDeactivated &&
      report.createdPromotionIds.length > 0 &&
      report.postCutoverVerification?.ok,
  );
}

export function toSafeMigrationCutoverAdminPayload(
  report: NewsletterMigrationCutoverReport,
): MigrationCutoverAdminSafePayload {
  const ok = migrationCutoverReportSucceeded(report);
  let errorCode: string | undefined;
  let error: string | undefined;

  if (!ok) {
    if (report.preconditionFailures.length > 0) {
      errorCode = "preconditions_failed";
      error = "Newsletter migration cutover preconditions were not met.";
    } else if (report.aborted) {
      errorCode = report.abortReason ?? "cutover_aborted";
      error = "Newsletter migration cutover did not complete.";
    } else if (report.postCutoverVerification && !report.postCutoverVerification.ok) {
      errorCode = "post_cutover_verification_failed";
      error = "Post-cutover verification failed.";
    } else {
      errorCode = "cutover_incomplete";
      error = "Newsletter migration cutover did not complete successfully.";
    }
  }

  return {
    ok,
    error,
    errorCode,
    migrationRunId: report.migrationRunId,
    mode: "apply",
    lifecyclePhase: report.lifecyclePhase,
    aborted: report.aborted,
    abortReason: report.abortReason,
    aggregate: {
      generatedAt: report.preflight.generatedAt,
      newsletterDiscountCode: report.preflight.newsletterDiscountCode,
      counts: report.preflight.counts,
      globalPromotionState: report.preflight.globalPromotionState,
      preconditionFailures: report.preconditionFailures.map((failure) => ({
        code: failure.code,
        message: failure.message,
      })),
      preparedCustomers: report.preparedCustomers?.map((customer) => ({
        emailRef: customer.emailRef,
        stripeCustomerId: customer.stripeCustomerId,
        created: customer.created,
      })),
      globalDeactivated: report.globalDeactivated,
      globalReactivationAttempted: report.globalReactivationAttempted,
      globalReactivationSucceeded: report.globalReactivationSucceeded,
      createdPromotionIds: report.createdPromotionIds,
      issuanceRecordedEmailRefs: report.issuanceRecordedFor,
      partialFailureDetail: report.partialFailureDetail,
    },
    postCutoverVerification: report.postCutoverVerification,
  };
}

export type MigrationCutoverAdminDeps = {
  isAdminAuthenticated: () => Promise<boolean>;
  runCutoverApply: () => Promise<NewsletterMigrationCutoverReport>;
};

export function migrationCutoverAdminMethodNotAllowedResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: "Method not allowed.",
      errorCode: "method_not_allowed",
    },
    {
      status: 405,
      headers: { ...NO_STORE_HEADERS, Allow: "POST" },
    },
  );
}

export async function migrationCutoverAdminPostResponse(
  request: Request,
  deps: MigrationCutoverAdminDeps,
): Promise<Response> {
  if (!(await deps.isAdminAuthenticated())) {
    return Response.json(
      { ok: false, error: "Unauthorized.", errorCode: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let body: { confirm?: unknown };
  try {
    body = (await request.json()) as { confirm?: unknown };
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body.", errorCode: "invalid_body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (body.confirm !== NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION) {
    return Response.json(
      {
        ok: false,
        error: "Missing or invalid cutover confirmation.",
        errorCode: "confirmation_required",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const report = await deps.runCutoverApply();
    const payload = toSafeMigrationCutoverAdminPayload(report);
    const status = payload.ok ? 200 : 422;
    return Response.json(payload, { status, headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Newsletter migration cutover failed.",
        errorCode: "internal_error",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

/**
 * Loads live data, runs preflight, then dry-run or apply cutover orchestration.
 */
export async function executeNewsletterMigrationCutover(
  options: ExecuteNewsletterMigrationCutoverOptions,
): Promise<NewsletterMigrationCutoverReport> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
  const couponId = getNewsletterStripeCouponId();

  const preflightReport = await executeNewsletterMigrationPreflight();
  const leads = await readStoredLeads();
  const redeemedEmails = await loadNewsletterRedeemedEmails();
  const issuanceEmails = await loadNewsletterIssuanceEmails();

  const eligibleEmails = listCutoverEligibleSubscriberEmails(
    leads,
    redeemedEmails,
    issuanceEmails,
  );

  return runNewsletterMigrationCutover({
    apply: options.apply,
    expected: options.expected ?? DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    preflightReport,
    stripe,
    newsletterCouponId: couponId,
    eligibleEmails,
    redeemedCount: preflightReport.counts.alreadyRedeemed,
    searchCustomersByEmail: (s, email) =>
      searchStripeCustomersByEmail(s, email, { limit: 20 }),
    createCustomerByEmail: (s, email) => findOrCreateStripeCustomerByEmail(s, email),
    listAllIssuanceRows: loadAllIssuanceRows,
  });
}
