import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import {
  collectUniqueNormalizedSubscriberEmails,
  maskEmailForMigrationReport,
  runNewsletterMigrationPreflight,
} from "./newsletter-migration-preflight";

test("collectUniqueNormalizedSubscriberEmails deduplicates and normalizes", () => {
  const result = collectUniqueNormalizedSubscriberEmails([
    { email: "  Alice@Example.com ", signedUpAt: "2026-01-01" },
    { email: "alice@example.com", signedUpAt: "2026-01-02" },
    { email: "not-an-email", signedUpAt: "2026-01-03" },
  ]);

  assert.equal(result.blobLeadRecordsRead, 3);
  assert.equal(result.invalidRecords, 1);
  assert.deepEqual(result.uniqueNormalizedSubscribers, ["alice@example.com"]);
});

test("maskEmailForMigrationReport does not expose full local part", () => {
  const masked = maskEmailForMigrationReport("naptime1322@yahoo.com");
  assert.doesNotMatch(masked, /naptime1322/);
  assert.match(masked, /@yahoo\.com#/);
});

test("runNewsletterMigrationPreflight classifies subscribers and performs no writes", async () => {
  let customerCreates = 0;
  let promoCreates = 0;

  const stripe = {
    customers: {
      search: async ({ query }: { query: string }) => {
        if (query.includes("one@example.com")) {
          return { data: [{ id: "cus_one" }] };
        }
        if (query.includes("multi@example.com")) {
          return { data: [{ id: "cus_a" }, { id: "cus_b" }] };
        }
        return { data: [] };
      },
      create: async () => {
        customerCreates += 1;
        return { id: "cus_created" };
      },
    },
    promotionCodes: {
      list: async (params: Stripe.PromotionCodeListParams) => {
        if (params.customer === "cus_one") {
          return {
            data: [
              {
                id: "promo_customer_one",
                code: "TWILIGHTFEATHER10",
                customer: "cus_one",
                promotion: { type: "coupon", coupon: "s63l6Ovq" },
              } as Stripe.PromotionCode,
            ],
          };
        }
        if (!params.customer) {
          return {
            data: [
              {
                id: "promo_global",
                code: "TWILIGHTFEATHER10",
                customer: null,
                active: true,
                promotion: { type: "coupon", coupon: "s63l6Ovq" },
              } as Stripe.PromotionCode,
            ],
          };
        }
        return { data: [] };
      },
      create: async () => {
        promoCreates += 1;
        return { id: "promo_created" };
      },
      update: async () => {
        promoCreates += 1;
        return {} as Stripe.PromotionCode;
      },
    },
  } as unknown as Stripe;

  const report = await runNewsletterMigrationPreflight({
    leads: [
      { email: "redeemed@example.com", signedUpAt: "1" },
      { email: "issued@example.com", signedUpAt: "2" },
      { email: "needs@example.com", signedUpAt: "3" },
      { email: "one@example.com", signedUpAt: "4" },
      { email: "multi@example.com", signedUpAt: "5" },
      { email: "bad", signedUpAt: "6" },
    ],
    redeemedEmails: new Set(["redeemed@example.com"]),
    issuanceEmails: new Set(["issued@example.com"]),
    newsletterCouponId: "s63l6Ovq",
    stripe,
    searchCustomersByEmail: async (s, email) => {
      const found = await s.customers.search({
        query: `email:'${email}'`,
        limit: 20,
      });
      return found.data ?? [];
    },
    listCustomerNewsletterPromotions: async (s, customerId, couponId) => {
      const listed = await s.promotionCodes.list({
        code: "TWILIGHTFEATHER10",
        customer: customerId,
        active: true,
        limit: 100,
      });
      return listed.data.filter((promotionCode) => {
        const coupon =
          typeof promotionCode.promotion?.coupon === "string"
            ? promotionCode.promotion.coupon
            : promotionCode.promotion?.coupon?.id;
        return coupon === couponId;
      });
    },
    listActiveNewsletterPromotions: async (s) => {
      const listed = await s.promotionCodes.list({
        code: "TWILIGHTFEATHER10",
        active: true,
        limit: 100,
      });
      return listed.data;
    },
  });

  assert.equal(report.counts.uniqueNormalizedSubscribers, 5);
  assert.equal(report.counts.invalidRecords, 1);
  assert.equal(report.counts.alreadyRedeemed, 1);
  assert.equal(report.counts.existingIssuanceRecords, 1);
  assert.equal(report.counts.subscribersNeedingMigration, 3);
  assert.equal(report.counts.needingStripeCustomer, 1);
  assert.equal(report.counts.exactlyOneStripeCustomer, 1);
  assert.equal(report.counts.multipleStripeCustomerMatches, 1);
  assert.equal(report.globalPromotionState.hasActiveUnrestricted, true);
  assert.equal(
    report.globalPromotionState.activeUnrestrictedPromotionCodeIds[0],
    "promo_global",
  );
  assert.ok(
    report.anomalies.some((a) => a.code === "existing_customer_specific_promotion"),
  );
  assert.ok(report.anomalies.some((a) => a.code === "multiple_stripe_customers"));
  assert.equal(customerCreates, 0);
  assert.equal(promoCreates, 0);
});
