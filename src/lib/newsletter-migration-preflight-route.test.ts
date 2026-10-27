import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { MigrationPreflightReport } from "./newsletter-migration-preflight";
import {
  executeNewsletterMigrationPreflight,
  migrationPreflightAdminResponse,
} from "./newsletter-migration-preflight-run";

const sampleReport: MigrationPreflightReport = {
  generatedAt: "2026-10-01T00:00:00.000Z",
  newsletterDiscountCode: "TWILIGHTFEATHER10",
  globalPromotionState: {
    hasActiveUnrestricted: true,
    activeUnrestrictedPromotionCodeIds: ["promo_global_example"],
    activeCustomerRestrictedPromotionCodeCount: 0,
  },
  counts: {
    blobLeadRecordsRead: 2,
    uniqueNormalizedSubscribers: 1,
    invalidRecords: 0,
    alreadyRedeemed: 0,
    existingIssuanceRecords: 0,
    subscribersNeedingMigration: 1,
    needingStripeCustomer: 1,
    exactlyOneStripeCustomer: 0,
    multipleStripeCustomerMatches: 0,
    existingCustomerSpecificNewsletterPromotion: 0,
    anomalies: 0,
    errors: 0,
  },
  anomalies: [],
  errors: [],
};

test("migrationPreflightAdminResponse returns 401 when unauthenticated", async () => {
  const response = await migrationPreflightAdminResponse({
    isAdminAuthenticated: async () => false,
    runPreflight: async () => sampleReport,
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.ok, false);
});

test("migrationPreflightAdminResponse invokes preflight when authenticated", async () => {
  let invoked = false;
  const response = await migrationPreflightAdminResponse({
    isAdminAuthenticated: async () => true,
    runPreflight: async () => {
      invoked = true;
      return sampleReport;
    },
  });
  assert.equal(invoked, true);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    report: MigrationPreflightReport;
  };
  assert.equal(body.ok, true);
  assert.equal(body.report.counts.blobLeadRecordsRead, 2);
  assert.equal(
    body.report.globalPromotionState.activeUnrestrictedPromotionCodeIds[0],
    "promo_global_example",
  );
});

test("migrationPreflightAdminResponse does not expose leads or secrets", async () => {
  const response = await migrationPreflightAdminResponse({
    isAdminAuthenticated: async () => true,
    runPreflight: async () => ({
      ...sampleReport,
      anomalies: [
        {
          code: "multiple_stripe_customers",
          emailRef: "na***@yahoo.com#abc12345",
          detail: "2 Stripe customers share this email.",
        },
      ],
    }),
  });
  const raw = await response.text();
  assert.doesNotMatch(raw, /subscriber@example\.com/);
  assert.doesNotMatch(raw, /sk_live/);
  assert.doesNotMatch(raw, /DATABASE_URL/);
  assert.doesNotMatch(raw, /BLOB_READ_WRITE_TOKEN/);
  assert.doesNotMatch(raw, /NEWSLETTER_STRIPE_COUPON_ID/);
  assert.doesNotMatch(raw, /"leads"\s*:/);
  assert.match(raw, /na\*\*\*@yahoo\.com#abc12345/);
});

test("migrationPreflightAdminResponse returns 500 without leaking error details", async () => {
  const response = await migrationPreflightAdminResponse({
    isAdminAuthenticated: async () => true,
    runPreflight: async () => {
      throw new Error("sk_live_secret_should_not_appear");
    },
  });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.error, "Newsletter migration preflight failed.");
  assert.doesNotMatch(JSON.stringify(body), /sk_live/);
});

test("admin migration-preflight route uses shared auth and read-only runner", () => {
  const routeSource = readFileSync(
    new URL(
      "../app/api/admin/newsletter/migration-preflight/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const runSource = readFileSync(
    new URL("./newsletter-migration-preflight-run.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /isAdminAuthenticated/);
  assert.match(routeSource, /executeNewsletterMigrationPreflight/);
  assert.match(routeSource, /export const runtime = "nodejs"/);
  assert.doesNotMatch(routeSource, /promotionCodes\.create/);
  assert.doesNotMatch(routeSource, /customers\.create/);

  assert.match(runSource, /runNewsletterMigrationPreflight/);
  assert.match(runSource, /readStoredLeads/);
  assert.match(runSource, /SELECT email FROM newsletter_promotion_redemptions/);
  assert.match(runSource, /searchStripeCustomersByEmail/);
  assert.doesNotMatch(runSource, /promotionCodes\.create/);
  assert.doesNotMatch(runSource, /promotionCodes\.update/);
  assert.doesNotMatch(runSource, /customers\.create/);
  assert.doesNotMatch(runSource, /\.put\(/);
});

test("executeNewsletterMigrationPreflight is exported for CLI and route sharing", () => {
  assert.equal(typeof executeNewsletterMigrationPreflight, "function");
});
