import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { NewsletterMigrationCutoverReport } from "./newsletter-migration-cutover";
import {
  executeNewsletterMigrationCutover,
  migrationCutoverAdminMethodNotAllowedResponse,
  migrationCutoverAdminPostResponse,
  NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION,
  toSafeMigrationCutoverAdminPayload,
} from "./newsletter-migration-cutover-run";

function sampleCutoverReport(
  overrides?: Partial<NewsletterMigrationCutoverReport>,
): NewsletterMigrationCutoverReport {
  return {
    mode: "apply",
    migrationRunId: "newsletter-cutover-test-run",
    lifecyclePhase: "pre_cutover_pristine",
    preflight: {
      generatedAt: "2026-10-01T22:41:53.764Z",
      newsletterDiscountCode: "TWILIGHTFEATHER10",
      globalPromotionState: {
        hasActiveUnrestricted: true,
        activeUnrestrictedPromotionCodeIds: ["promo_1U4q3uGmFetwj9NcROsrrqWM"],
        activeCustomerRestrictedPromotionCodeCount: 0,
      },
      counts: {
        blobLeadRecordsRead: 2,
        uniqueNormalizedSubscribers: 2,
        invalidRecords: 0,
        alreadyRedeemed: 0,
        existingIssuanceRecords: 0,
        subscribersNeedingMigration: 2,
        needingStripeCustomer: 1,
        exactlyOneStripeCustomer: 1,
        multipleStripeCustomerMatches: 0,
        existingCustomerSpecificNewsletterPromotion: 0,
        anomalies: 0,
        errors: 0,
      },
      anomalies: [],
      errors: [],
    },
    preconditionFailures: [],
    aborted: false,
    createdPromotionIds: ["promo_cus_a", "promo_cus_b"],
    issuanceRecordedFor: ["al***@example.com#abc12345", "bo***@example.com#def67890"],
    globalDeactivated: true,
    postCutoverVerification: {
      ok: true,
      checks: [{ code: "global_inactive", ok: true, detail: "active unrestricted TWILIGHTFEATHER10 count: 0" }],
    },
    preparedCustomers: [
      {
        normalizedEmail: "secret-alice@example.com",
        emailRef: "al***@example.com#abc12345",
        stripeCustomerId: "cus_alice",
        created: false,
      },
    ],
    ...overrides,
  };
}

function postRequest(confirm?: string): Request {
  return new Request("https://twilight-feather.com/api/admin/newsletter/migration-cutover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirm === undefined ? {} : { confirm }),
  });
}

test("migrationCutoverAdminPostResponse returns 401 when unauthenticated", async () => {
  const response = await migrationCutoverAdminPostResponse(postRequest(NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION), {
    isAdminAuthenticated: async () => false,
    runCutoverApply: async () => sampleCutoverReport(),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.errorCode, "unauthorized");
});

test("migrationCutoverAdminMethodNotAllowedResponse returns 405 for GET", async () => {
  const response = migrationCutoverAdminMethodNotAllowedResponse();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Allow"), "POST");
});

test("migrationCutoverAdminPostResponse rejects missing confirmation without invoking cutover", async () => {
  let invoked = false;
  const response = await migrationCutoverAdminPostResponse(postRequest(), {
    isAdminAuthenticated: async () => true,
    runCutoverApply: async () => {
      invoked = true;
      return sampleCutoverReport();
    },
  });
  assert.equal(invoked, false);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.errorCode, "confirmation_required");
});

test("migrationCutoverAdminPostResponse rejects incorrect confirmation without invoking cutover", async () => {
  let invoked = false;
  const response = await migrationCutoverAdminPostResponse(
    postRequest("WRONG_CONFIRMATION"),
    {
      isAdminAuthenticated: async () => true,
      runCutoverApply: async () => {
        invoked = true;
        return sampleCutoverReport();
      },
    },
  );
  assert.equal(invoked, false);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.errorCode, "confirmation_required");
});

test("migrationCutoverAdminPostResponse invokes apply cutover when confirmed and authenticated", async () => {
  let invoked = false;
  const response = await migrationCutoverAdminPostResponse(
    postRequest(NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION),
    {
      isAdminAuthenticated: async () => true,
      runCutoverApply: async () => {
        invoked = true;
        return sampleCutoverReport();
      },
    },
  );
  assert.equal(invoked, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = (await response.json()) as {
    ok: boolean;
    migrationRunId: string;
    aggregate: { createdPromotionIds: string[] };
  };
  assert.equal(body.ok, true);
  assert.equal(body.migrationRunId, "newsletter-cutover-test-run");
  assert.deepEqual(body.aggregate.createdPromotionIds, ["promo_cus_a", "promo_cus_b"]);
});

test("migrationCutoverAdminPostResponse returns safe failure when preconditions fail", async () => {
  const response = await migrationCutoverAdminPostResponse(
    postRequest(NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION),
    {
      isAdminAuthenticated: async () => true,
      runCutoverApply: async () =>
        sampleCutoverReport({
          aborted: true,
          abortReason: "preconditions_failed",
          preconditionFailures: [
            {
              code: "subscriber_count_changed",
              message: "Expected 2 unique normalized subscribers, found 3.",
            },
          ],
          createdPromotionIds: [],
          globalDeactivated: false,
          postCutoverVerification: undefined,
        }),
    },
  );
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.errorCode, "preconditions_failed");
  assert.equal(body.aggregate.globalDeactivated, false);
});

test("migrationCutoverAdminPostResponse does not leak secrets or full subscriber emails", async () => {
  const response = await migrationCutoverAdminPostResponse(
    postRequest(NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION),
    {
      isAdminAuthenticated: async () => true,
      runCutoverApply: async () => sampleCutoverReport(),
    },
  );
  const raw = await response.text();
  assert.doesNotMatch(raw, /secret-alice@example\.com/);
  assert.doesNotMatch(raw, /sk_live/);
  assert.doesNotMatch(raw, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(raw, /DATABASE_URL/);
  assert.doesNotMatch(raw, /BLOB_READ_WRITE_TOKEN/);
  assert.doesNotMatch(raw, /NEWSLETTER_STRIPE_COUPON_ID/);
  assert.doesNotMatch(raw, /ADMIN_SESSION_SECRET/);
  assert.match(raw, /al\*\*\*@example\.com#abc12345/);
});

test("migrationCutoverAdminPostResponse returns 500 without leaking error details", async () => {
  const response = await migrationCutoverAdminPostResponse(
    postRequest(NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION),
    {
      isAdminAuthenticated: async () => true,
      runCutoverApply: async () => {
        throw new Error("sk_live_secret_should_not_appear");
      },
    },
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "Newsletter migration cutover failed.");
  assert.doesNotMatch(JSON.stringify(body), /sk_live/);
});

test("toSafeMigrationCutoverAdminPayload omits normalized subscriber emails", () => {
  const payload = toSafeMigrationCutoverAdminPayload(sampleCutoverReport());
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /normalizedEmail/);
  assert.doesNotMatch(serialized, /secret-alice@example\.com/);
  assert.ok(payload.aggregate.preparedCustomers?.[0]?.emailRef);
});

test("admin migration-cutover route uses shared auth and apply runner", () => {
  const routeSource = readFileSync(
    new URL(
      "../app/api/admin/newsletter/migration-cutover/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const runSource = readFileSync(
    new URL("./newsletter-migration-cutover-run.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /isAdminAuthenticated/);
  assert.match(routeSource, /executeNewsletterMigrationCutover/);
  assert.match(routeSource, /apply:\s*true/);
  assert.match(routeSource, /export const runtime = "nodejs"/);
  assert.match(routeSource, /migrationCutoverAdminPostResponse/);
  assert.match(routeSource, /migrationCutoverAdminMethodNotAllowedResponse/);
  assert.doesNotMatch(routeSource, /runNewsletterMigrationCutover/);

  assert.match(runSource, /runNewsletterMigrationCutover/);
  assert.match(runSource, /NEWSLETTER_MIGRATION_CUTOVER_CONFIRMATION/);
});

test("executeNewsletterMigrationCutover is exported for CLI and route sharing", () => {
  assert.equal(typeof executeNewsletterMigrationCutover, "function");
});
