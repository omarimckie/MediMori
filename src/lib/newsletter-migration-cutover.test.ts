import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import {
  createNewsletterMigrationRunId,
  DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
  detectCutoverLifecyclePhase,
  formatNewsletterMigrationRollbackProcedure,
  listCutoverEligibleSubscriberEmails,
  runNewsletterMigrationCutover,
  setGlobalNewsletterPromotionActive,
  validateNewsletterCutoverPreconditions,
  verifyPostCutoverState,
  type NewsletterMigrationCutoverDeps,
} from "./newsletter-migration-cutover";
import {
  formatMigrationPreflightReport,
  runNewsletterMigrationPreflight,
  type MigrationPreflightReport,
} from "./newsletter-migration-preflight";
import { buildCustomerSpecificPromotionCodeCreateParams } from "./newsletter-promotion-issuance";

const COUPON = "s63l6Ovq";
const GLOBAL_ID = DEFAULT_PRODUCTION_CUTOVER_EXPECTED.globalPromotionId;

function pristinePreflight(overrides?: Partial<MigrationPreflightReport>): MigrationPreflightReport {
  const base: MigrationPreflightReport = {
    generatedAt: "2026-10-01T22:41:53.764Z",
    newsletterDiscountCode: "TWILIGHTFEATHER10",
    globalPromotionState: {
      hasActiveUnrestricted: true,
      activeUnrestrictedPromotionCodeIds: [GLOBAL_ID],
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
  };
  return { ...base, ...overrides, counts: { ...base.counts, ...overrides?.counts }, globalPromotionState: { ...base.globalPromotionState, ...overrides?.globalPromotionState } };
}

function mockStripeForCutover(handlers: {
  customersByEmail: Record<string, Stripe.Customer[]>;
  globalActive?: boolean;
  globalCustomer?: string | null;
  onCustomerCreate?: () => void;
  onGlobalUpdate?: (active: boolean) => void;
  onPromoCreate?: (params: Stripe.PromotionCodeCreateParams) => Stripe.PromotionCode;
  promoCreatesBeforeFail?: number;
}): Stripe {
  let promoCreateCount = 0;
  let globalActive = handlers.globalActive ?? true;
  const globalCustomer = handlers.globalCustomer ?? null;
  const customerPromos: Record<string, Stripe.PromotionCode[]> = {};

  return {
    customers: {
      search: async ({ query }: { query: string }) => {
        for (const [email, customers] of Object.entries(handlers.customersByEmail)) {
          if (query.includes(email)) {
            return { data: customers };
          }
        }
        return { data: [] };
      },
      create: async ({ email }: { email: string }) => {
        handlers.onCustomerCreate?.();
        return { id: `cus_created_${email}` };
      },
    },
    promotionCodes: {
      list: async (params: Stripe.PromotionCodeListParams) => {
        if (params.customer) {
          const all = customerPromos[params.customer] ?? [];
          const filtered =
            params.active === undefined
              ? all
              : all.filter((promo) => promo.active === params.active);
          return { data: filtered, has_more: false };
        }
        if (params.active && globalActive) {
          return {
            data: [
              {
                id: GLOBAL_ID,
                code: "TWILIGHTFEATHER10",
                active: true,
                customer: globalCustomer,
                max_redemptions: null,
                promotion: { type: "coupon", coupon: COUPON },
              } as Stripe.PromotionCode,
            ],
            has_more: false,
          };
        }
        return { data: [], has_more: false };
      },
      update: async (_id: string, params: { active?: boolean }) => {
        if (params.active !== undefined) {
          globalActive = params.active;
          handlers.onGlobalUpdate?.(params.active);
        }
        return {
          id: GLOBAL_ID,
          active: globalActive,
        } as Stripe.PromotionCode;
      },
      create: async (params: Stripe.PromotionCodeCreateParams) => {
        promoCreateCount += 1;
        if (
          handlers.promoCreatesBeforeFail !== undefined &&
          promoCreateCount > handlers.promoCreatesBeforeFail
        ) {
          throw new Error("stripe promo create failed");
        }
        const created = handlers.onPromoCreate?.(params) ?? {
          id: `promo_cust_${params.customer}`,
          code: "TWILIGHTFEATHER10",
          active: true,
          customer: params.customer as string,
          max_redemptions: 1,
          promotion: { type: "coupon", coupon: COUPON },
        };
        const customerId = params.customer as string;
        const stored = created as Stripe.PromotionCode;
        customerPromos[customerId] = [...(customerPromos[customerId] ?? []), stored];
        return stored;
      },
    },
  } as unknown as Stripe;
}

function baseDeps(
  overrides: Partial<NewsletterMigrationCutoverDeps>,
): NewsletterMigrationCutoverDeps {
  return {
    apply: false,
    expected: DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    preflightReport: pristinePreflight(),
    stripe: null,
    newsletterCouponId: COUPON,
    eligibleEmails: ["alice@example.com", "bob@example.com"],
    redeemedCount: 0,
    searchCustomersByEmail: async () => [],
    createCustomerByEmail: async () => "cus_x",
    listAllIssuanceRows: async () => [],
    ...overrides,
  };
}

test("createNewsletterMigrationRunId is unique and identifiable", () => {
  const id = createNewsletterMigrationRunId(new Date("2026-10-01T12:00:00.000Z"));
  assert.match(id, /^newsletter-cutover-2026-10-01T12-00-00-000Z-[a-f0-9]{8}$/);
});

test("listCutoverEligibleSubscriberEmails excludes redeemed and issuance", () => {
  const emails = listCutoverEligibleSubscriberEmails(
    [
      { email: "a@example.com", signedUpAt: "1" },
      { email: "b@example.com", signedUpAt: "2" },
      { email: "c@example.com", signedUpAt: "3" },
    ],
    new Set(["b@example.com"]),
    new Set(["c@example.com"]),
  );
  assert.deepEqual(emails, ["a@example.com"]);
});

test("default cutover dry-run performs no Stripe writes", async () => {
  let customerCreates = 0;
  let globalUpdates = 0;
  let promoCreates = 0;

  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [{ id: "cus_alice" } as Stripe.Customer],
      "bob@example.com": [],
    },
    onCustomerCreate: () => {
      customerCreates += 1;
    },
    onGlobalUpdate: () => {
      globalUpdates += 1;
    },
    onPromoCreate: () => {
      promoCreates += 1;
      return { id: "promo_x" } as Stripe.PromotionCode;
    },
  });

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      stripe,
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async (s, email) => {
        const created = await s.customers.create({ email });
        return created.id;
      },
    }),
  );

  assert.equal(report.mode, "dry_run");
  assert.equal(report.aborted, false);
  assert.equal(customerCreates, 0);
  assert.equal(globalUpdates, 0);
  assert.equal(promoCreates, 0);
  assert.equal(report.preparedCustomers?.length, 2);
  assert.equal(report.preparedCustomers?.[1].stripeCustomerId, "(would-create)");
});

function inMemoryIssuance() {
  const issuanceStore: {
    email: string;
    stripe_customer_id: string;
    stripe_promotion_code_id: string;
    migration_run_id: string | null;
  }[] = [];
  return {
    store: issuanceStore,
    record: async (input: {
      email: string;
      stripeCustomerId: string;
      stripePromotionCodeId: string;
      stripeCouponId: string;
      issuanceSource: string;
      migrationRunId?: string | null;
    }) => {
      issuanceStore.push({
        email: input.email,
        stripe_customer_id: input.stripeCustomerId,
        stripe_promotion_code_id: input.stripePromotionCodeId,
        migration_run_id: input.migrationRunId ?? null,
      });
      return {
        email: input.email,
        stripe_customer_id: input.stripeCustomerId,
        stripe_promotion_code_id: input.stripePromotionCodeId,
        stripe_coupon_id: input.stripeCouponId,
        issued_at: new Date(),
        issuance_source: input.issuanceSource as "migration",
        last_error: null,
        migration_run_id: input.migrationRunId ?? null,
      };
    },
    getByEmail: async (email: string) => {
      const row = issuanceStore.find((entry) => entry.email === email);
      if (!row) return null;
      return {
        email: row.email,
        stripe_customer_id: row.stripe_customer_id,
        stripe_promotion_code_id: row.stripe_promotion_code_id,
        stripe_coupon_id: COUPON,
        issued_at: new Date(),
        issuance_source: "migration" as const,
        last_error: null,
        migration_run_id: row.migration_run_id,
      };
    },
  };
}

test("apply is required for writes — apply path deactivates global and creates promos", async () => {
  const events: string[] = [];
  const issuance = inMemoryIssuance();

  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [{ id: "cus_alice" } as Stripe.Customer],
      "bob@example.com": [{ id: "cus_bob" } as Stripe.Customer],
    },
    onCustomerCreate: () => events.push("customer_create"),
    onGlobalUpdate: (active) => events.push(`global_${active ? "on" : "off"}`),
    onPromoCreate: (params) => {
      events.push(`promo_${params.customer}`);
      return {
        id: `promo_${params.customer}`,
        code: "TWILIGHTFEATHER10",
        active: true,
        customer: params.customer as string,
        max_redemptions: 1,
        promotion: { type: "coupon", coupon: COUPON },
      } as Stripe.PromotionCode;
    },
  });

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      migrationRunId: "newsletter-cutover-test-run",
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async () => {
        throw new Error("unexpected create");
      },
      listAllIssuanceRows: async () => issuance.store,
      recordIssuance: issuance.record,
      getIssuanceByEmail: issuance.getByEmail,
    }),
  );

  assert.equal(report.aborted, false);
  assert.deepEqual(events, [
    "global_off",
    "promo_cus_alice",
    "promo_cus_bob",
  ]);
  assert.equal(report.createdPromotionIds.length, 2);
  assert.equal(issuance.store.length, 2);
  assert.equal(report.issuanceRecordedFor.length, 2);
});

test("stale global promotion id aborts with no writes", async () => {
  let globalUpdates = 0;
  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [{ id: "cus_alice" } as Stripe.Customer],
      "bob@example.com": [{ id: "cus_bob" } as Stripe.Customer],
    },
    onGlobalUpdate: () => {
      globalUpdates += 1;
    },
  });

  const wrongGlobalReport = pristinePreflight({
    globalPromotionState: {
      hasActiveUnrestricted: true,
      activeUnrestrictedPromotionCodeIds: ["promo_OTHER"],
      activeCustomerRestrictedPromotionCodeCount: 0,
    },
  });

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      preflightReport: wrongGlobalReport,
      searchCustomersByEmail: async () => [{ id: "cus_x" } as Stripe.Customer],
    }),
  );
  assert.equal(report.aborted, true);
  assert.equal(globalUpdates, 0);
  assert.ok(
    report.preconditionFailures.some((f) =>
      ["global_promotion_id_mismatch", "unexpected_cutover_state", "stale_global_promotion_id"].includes(
        f.code,
      ),
    ),
  );
});

test("global already inactive aborts via unexpected state", async () => {
  const report = pristinePreflight({
    globalPromotionState: {
      hasActiveUnrestricted: false,
      activeUnrestrictedPromotionCodeIds: [],
      activeCustomerRestrictedPromotionCodeCount: 0,
    },
  });
  const failures = await validateNewsletterCutoverPreconditions(
    report,
    DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    null,
    COUPON,
  );
  assert.ok(failures.some((f) => f.code === "unexpected_cutover_state"));
});

test("global customer-restricted aborts", async () => {
  const stripe = mockStripeForCutover({
    customersByEmail: {},
    globalCustomer: "cus_restricted",
  });
  const failures = await validateNewsletterCutoverPreconditions(
    pristinePreflight(),
    DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    stripe,
    COUPON,
  );
  assert.ok(failures.some((f) => f.code === "global_promotion_customer_restricted"));
});

test("subscriber count changed aborts", async () => {
  const failures = await validateNewsletterCutoverPreconditions(
    pristinePreflight({
      counts: {
        ...pristinePreflight().counts,
        uniqueNormalizedSubscribers: 3,
        subscribersNeedingMigration: 3,
      },
    }),
    DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    null,
    COUPON,
  );
  assert.ok(failures.some((f) => f.code === "subscriber_count_changed"));
});

test("redemption appeared aborts", async () => {
  const failures = await validateNewsletterCutoverPreconditions(
    pristinePreflight({
      counts: { ...pristinePreflight().counts, alreadyRedeemed: 1 },
    }),
    DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    null,
    COUPON,
  );
  assert.ok(failures.some((f) => f.code === "redemption_count_changed"));
});

test("issuance appeared aborts", async () => {
  const failures = await validateNewsletterCutoverPreconditions(
    pristinePreflight({
      counts: { ...pristinePreflight().counts, existingIssuanceRecords: 1 },
    }),
    DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    null,
    COUPON,
  );
  assert.ok(failures.some((f) => f.code === "issuance_count_changed"));
});

test("duplicate stripe customers abort before global deactivation", async () => {
  let globalUpdates = 0;
  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [
        { id: "cus_a1" } as Stripe.Customer,
        { id: "cus_a2" } as Stripe.Customer,
      ],
      "bob@example.com": [{ id: "cus_bob" } as Stripe.Customer],
    },
    onGlobalUpdate: () => {
      globalUpdates += 1;
    },
  });

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async () => "cus_new",
    }),
  );

  assert.equal(report.aborted, true);
  assert.equal(report.abortReason, "ambiguous_stripe_customers");
  assert.equal(globalUpdates, 0);
});

test("customer creation failure aborts before global deactivation", async () => {
  let globalUpdates = 0;
  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [{ id: "cus_alice" } as Stripe.Customer],
      "bob@example.com": [],
    },
    onGlobalUpdate: () => {
      globalUpdates += 1;
    },
  });

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async () => {
        throw new Error("stripe customer create failed");
      },
    }),
  );

  assert.equal(report.aborted, true);
  assert.equal(report.abortReason, "customer_create_failed");
  assert.equal(globalUpdates, 0);
});

test("global deactivation happens only after customer preparation", async () => {
  const events: string[] = [];
  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [],
      "bob@example.com": [{ id: "cus_bob" } as Stripe.Customer],
    },
    onCustomerCreate: () => events.push("customer_create"),
    onGlobalUpdate: (active) => events.push(`global_${active ? "on" : "off"}`),
    onPromoCreate: (params) => {
      events.push(`promo_${params.customer}`);
      return {
        id: `promo_${params.customer}`,
        code: "TWILIGHTFEATHER10",
        active: true,
        customer: params.customer as string,
        max_redemptions: 1,
        promotion: { type: "coupon", coupon: COUPON },
      } as Stripe.PromotionCode;
    },
  });

  const issuance = inMemoryIssuance();

  await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      recordIssuance: issuance.record,
      getIssuanceByEmail: issuance.getByEmail,
      listAllIssuanceRows: async () => issuance.store,
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async (s, email) => {
        events.push(`create_${email}`);
        const created = await s.customers.create({ email });
        return created.id;
      },
    }),
  );

  const customerCreateIndex = events.indexOf("customer_create");
  const globalOffIndex = events.indexOf("global_off");
  assert.ok(customerCreateIndex >= 0);
  assert.ok(globalOffIndex > customerCreateIndex);
});

test("partial promotion creation failure attempts global reactivation", async () => {
  let globalActive = true;
  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [{ id: "cus_alice" } as Stripe.Customer],
      "bob@example.com": [{ id: "cus_bob" } as Stripe.Customer],
    },
    onGlobalUpdate: (active) => {
      globalActive = active;
    },
    promoCreatesBeforeFail: 1,
    onPromoCreate: (params) =>
      ({
        id: `promo_${params.customer}`,
        code: "TWILIGHTFEATHER10",
        active: true,
        customer: params.customer as string,
        max_redemptions: 1,
        promotion: { type: "coupon", coupon: COUPON },
      }) as Stripe.PromotionCode,
  });

  const issuance = inMemoryIssuance();

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async () => "cus_x",
      recordIssuance: issuance.record,
      getIssuanceByEmail: issuance.getByEmail,
      listAllIssuanceRows: async () => issuance.store,
    }),
  );

  assert.equal(report.aborted, true);
  assert.equal(report.globalDeactivated, true);
  assert.equal(report.globalReactivationAttempted, true);
  assert.equal(report.globalReactivationSucceeded, true);
  assert.equal(globalActive, true);
  assert.equal(report.createdPromotionIds.length, 1);
});

test("buildCustomerSpecificPromotionCodeCreateParams includes migration metadata", () => {
  const params = buildCustomerSpecificPromotionCodeCreateParams(
    "cus_x",
    COUPON,
    { migrationRunId: "newsletter-cutover-test" },
  );
  assert.equal(params.metadata?.migration_run_id, "newsletter-cutover-test");
  assert.equal(params.metadata?.issuance_source, "migration");
});

test("already complete phase runs post verification without writes", async () => {
  let globalUpdates = 0;
  const completePreflight = pristinePreflight({
    globalPromotionState: {
      hasActiveUnrestricted: false,
      activeUnrestrictedPromotionCodeIds: [],
      activeCustomerRestrictedPromotionCodeCount: 2,
    },
    counts: {
      ...pristinePreflight().counts,
      existingIssuanceRecords: 2,
      subscribersNeedingMigration: 0,
    },
  });

  assert.equal(
    detectCutoverLifecyclePhase(
      completePreflight,
      DEFAULT_PRODUCTION_CUTOVER_EXPECTED,
    ),
    "already_complete",
  );

  const stripe = mockStripeForCutover({
    customersByEmail: {},
    globalActive: false,
    onGlobalUpdate: () => {
      globalUpdates += 1;
    },
    onPromoCreate: (params) =>
      ({
        id: params.customer === "cus_alice" ? "promo_alice" : "promo_bob",
        code: "TWILIGHTFEATHER10",
        active: true,
        customer: params.customer as string,
        max_redemptions: 1,
        promotion: { type: "coupon", coupon: COUPON },
      }) as Stripe.PromotionCode,
  });
  // Seed customer promos for post-cutover verification list
  await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: COUPON },
    code: "TWILIGHTFEATHER10",
    customer: "cus_alice",
    max_redemptions: 1,
    active: true,
  } as Stripe.PromotionCodeCreateParams);
  await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: COUPON },
    code: "TWILIGHTFEATHER10",
    customer: "cus_bob",
    max_redemptions: 1,
    active: true,
  } as Stripe.PromotionCodeCreateParams);

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      preflightReport: completePreflight,
      stripe,
      listAllIssuanceRows: async () => [
        {
          email: "alice@example.com",
          stripe_customer_id: "cus_alice",
          stripe_promotion_code_id: "promo_alice",
          migration_run_id: "prior-run",
        },
        {
          email: "bob@example.com",
          stripe_customer_id: "cus_bob",
          stripe_promotion_code_id: "promo_bob",
          migration_run_id: "prior-run",
        },
      ],
    }),
  );

  assert.equal(report.aborted, false);
  assert.equal(globalUpdates, 0);
  assert.ok(report.postCutoverVerification);
});

test("rollback procedure is documented", () => {
  const guide = formatNewsletterMigrationRollbackProcedure();
  assert.match(guide, /reactivat/i);
  assert.ok(guide.includes(GLOBAL_ID));
});

test("setGlobalNewsletterPromotionActive wraps stripe update", async () => {
  const stripe = mockStripeForCutover({ customersByEmail: {} });
  const off = await setGlobalNewsletterPromotionActive(stripe, GLOBAL_ID, false);
  assert.equal(off.ok, true);
  if (off.ok) assert.equal(off.active, false);
});

test("verifyPostCutoverState checks aggregate expectations", async () => {
  const stripe = {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: "promo_a",
            code: "TWILIGHTFEATHER10",
            active: true,
            customer: "cus_a",
            max_redemptions: 1,
            promotion: { type: "coupon", coupon: COUPON },
          },
          {
            id: "promo_b",
            code: "TWILIGHTFEATHER10",
            active: true,
            customer: "cus_b",
            max_redemptions: 1,
            promotion: { type: "coupon", coupon: COUPON },
          },
        ],
        has_more: false,
      }),
    },
  } as unknown as Stripe;

  const result = await verifyPostCutoverState(stripe, COUPON, 2, 0, [
    {
      email: "alice@example.com",
      stripe_customer_id: "cus_a",
      stripe_promotion_code_id: "promo_a",
    },
    {
      email: "bob@example.com",
      stripe_customer_id: "cus_b",
      stripe_promotion_code_id: "promo_b",
    },
  ]);
  assert.equal(result.ok, true);
});

test("safe rerun does not duplicate issuance when row already exists", async () => {
  let promoCreates = 0;
  const issuance = inMemoryIssuance();
  await issuance.record({
    email: "alice@example.com",
    stripeCustomerId: "cus_alice",
    stripePromotionCodeId: "promo_alice",
    stripeCouponId: COUPON,
    issuanceSource: "migration",
    migrationRunId: "prior-run",
  });

  const stripe = mockStripeForCutover({
    customersByEmail: {
      "alice@example.com": [{ id: "cus_alice" } as Stripe.Customer],
      "bob@example.com": [{ id: "cus_bob" } as Stripe.Customer],
    },
    onPromoCreate: () => {
      promoCreates += 1;
      return { id: "promo_new" } as Stripe.PromotionCode;
    },
  });

  const partialPreflight = pristinePreflight({
    counts: {
      ...pristinePreflight().counts,
      existingIssuanceRecords: 1,
      subscribersNeedingMigration: 1,
    },
  });

  const report = await runNewsletterMigrationCutover(
    baseDeps({
      apply: true,
      stripe,
      preflightReport: partialPreflight,
      eligibleEmails: ["alice@example.com", "bob@example.com"],
      searchCustomersByEmail: async (s, email) => {
        const found = await s.customers.search({ query: `email:'${email}'` });
        return found.data ?? [];
      },
      createCustomerByEmail: async () => "cus_x",
      recordIssuance: issuance.record,
      getIssuanceByEmail: issuance.getByEmail,
      listAllIssuanceRows: async () => issuance.store,
    }),
  );

  assert.equal(report.aborted, true);
  assert.ok(report.preconditionFailures.some((f) => f.code === "unexpected_cutover_state"));
  assert.equal(promoCreates, 0);
});

test("runNewsletterMigrationPreflight integration remains read-only in cutover context", async () => {
  let writes = 0;
  const stripe = {
    customers: { search: async () => ({ data: [] }), create: async () => { writes += 1; return { id: "x" }; } },
    promotionCodes: {
      list: async () => ({ data: [] }),
      create: async () => { writes += 1; return { id: "x" }; },
      update: async () => { writes += 1; return { id: "x", active: true }; },
    },
  } as unknown as Stripe;

  await runNewsletterMigrationPreflight({
    leads: [{ email: "a@example.com", signedUpAt: "1" }],
    redeemedEmails: new Set(),
    issuanceEmails: new Set(),
    newsletterCouponId: COUPON,
    stripe,
    searchCustomersByEmail: async () => [],
    listCustomerNewsletterPromotions: async () => [],
    listActiveNewsletterPromotions: async () => [],
  });
  assert.equal(writes, 0);
  assert.ok(formatMigrationPreflightReport);
});
