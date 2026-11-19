import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  assertPlannerE2eApproveAllowed,
  assertPlannerStagingE2eOwnedContentIds,
  evaluatePlannerStagingE2eHttpMutation,
  integrationBranchPlannerStagingRef,
  isPlannerStagingE2eAllowlistedMutation,
  isPlannerStagingE2eArmed,
  isPlannerStagingE2eScopeActive,
  MARKETING_PLANNER_STAGING_E2E_ENV,
  PLANNER_E2E_STAGING_TAG,
  PLANNER_STAGING_E2E_ALLOWLIST_MESSAGE,
  PLANNER_STAGING_E2E_SCOPE_MESSAGE,
} from "./planner-staging-e2e-gate";
import { MARKETING_STAGING_NEON_PROJECT_ID_ENV } from "./staging-planner-db-guard";
import { MARKETING_PREVIEW_READONLY_MESSAGE } from "./preview-readonly";
import { MemoryMarketingStore } from "./memory-store";

const STAGING = "small-frost-27394379";
const PROD = "solitary-leaf-77946642";

function integrationPreview(env: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: integrationBranchPlannerStagingRef(),
    MARKETING_MOCK_MODE: "true",
    [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: STAGING,
    MARKETING_PREVIEW_READONLY: "false",
    ...env,
  };
}

const ORIGINAL = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) {
    if (!(key in env) && key in ORIGINAL) {
      process.env[key] = ORIGINAL[key];
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  applyEnv(ORIGINAL);
});

test("readonly remains authoritative when E2E flag is enabled", () => {
  const env = {
    ...integrationPreview(),
    MARKETING_PREVIEW_READONLY: "true",
    [MARKETING_PLANNER_STAGING_E2E_ENV]: "true",
  };
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/add-to-planner",
      "POST",
      env,
    ),
    "readonly",
  );
  assert.match(MARKETING_PREVIEW_READONLY_MESSAGE, /read-only/i);
});

test("E2E mode cannot activate on production", () => {
  const env = {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: integrationBranchPlannerStagingRef(),
    [MARKETING_PLANNER_STAGING_E2E_ENV]: "true",
    [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: STAGING,
    MARKETING_MOCK_MODE: "true",
  };
  assert.equal(isPlannerStagingE2eScopeActive(env), false);
  assert.equal(isPlannerStagingE2eArmed(env), false);
});

test("E2E scope does not activate on unrelated Preview branches", () => {
  const env = {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "main",
    [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: STAGING,
    MARKETING_MOCK_MODE: "true",
    [MARKETING_PLANNER_STAGING_E2E_ENV]: "true",
  };
  assert.equal(isPlannerStagingE2eScopeActive(env), false);
});

test("invalid staging project fails closed at scope", () => {
  const env = integrationPreview({
    [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: PROD,
  });
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/add-to-planner",
      "POST",
      env,
    ),
    "skip",
  );
  assert.equal(isPlannerStagingE2eArmed(env), false);
});

test("mock mode disabled fails closed", () => {
  const env = integrationPreview({
    MARKETING_MOCK_MODE: "false",
    [MARKETING_PLANNER_STAGING_E2E_ENV]: "true",
  });
  assert.equal(isPlannerStagingE2eArmed(env), false);
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/add-to-planner",
      "POST",
      env,
    ),
    "scope_unarmed",
  );
});

test("scope unarmed blocks unrelated marketing mutations", () => {
  const env = integrationPreview();
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/settings",
      "POST",
      env,
    ),
    "scope_unarmed",
  );
});

test("armed allowlist permits planner routes only", () => {
  const env = integrationPreview({ [MARKETING_PLANNER_STAGING_E2E_ENV]: "true" });
  assert.equal(isPlannerStagingE2eArmed(env), true);
  for (const path of [
    "/api/admin/marketing/content/add-to-planner",
    "/api/admin/marketing/content/remove-from-planner",
    "/api/admin/marketing/content/assign-week",
    "/api/admin/marketing/planner-e2e/fixtures",
    "/api/admin/marketing/planner-e2e/cleanup",
  ]) {
    assert.equal(
      evaluatePlannerStagingE2eHttpMutation(path, "POST", env),
      "allow",
      path,
    );
    assert.equal(isPlannerStagingE2eAllowlistedMutation(path, "POST"), true, path);
  }
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation("/api/admin/marketing/manual/post", "POST", env),
    "deny_allowlist",
  );
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation("/api/cron/marketing-publish", "POST", env),
    "deny_allowlist",
  );
});

test("cron and publishing routes stay blocked when armed", () => {
  const env = integrationPreview({ [MARKETING_PLANNER_STAGING_E2E_ENV]: "true" });
  for (const [path, method] of [
    ["/api/cron/marketing-publish", "POST"],
    ["/api/cron/marketing-publish", "GET"],
    ["/api/admin/marketing/publications/abc/retry", "POST"],
    ["/api/admin/marketing/content/smart-upload/finalize", "POST"],
  ] as const) {
    assert.equal(evaluatePlannerStagingE2eHttpMutation(path, method, env), "deny_allowlist");
  }
});

test("ownership: tagged content allowed; untagged non-demo rejected when armed", async () => {
  const store = new MemoryMarketingStore();
  applyEnv(integrationPreview({ [MARKETING_PLANNER_STAGING_E2E_ENV]: "true" }));
  const taggedId = crypto.randomUUID();
  await store.createContent({
    id: taggedId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-e2e",
    originalBody: null,
    bookId: null,
    metadata: { e2eTag: PLANNER_E2E_STAGING_TAG } as Record<string, unknown>,
    isDemo: true,
  });
  await assertPlannerStagingE2eOwnedContentIds(store, [taggedId]);

  const legacyId = crypto.randomUUID();
  await store.createContent({
    id: legacyId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-leg",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
  });
  await assert.rejects(() => assertPlannerStagingE2eOwnedContentIds(store, [legacyId]));
});

test("approve rejects demo content without e2eTag when armed", async () => {
  const store = new MemoryMarketingStore();
  applyEnv(integrationPreview({ [MARKETING_PLANNER_STAGING_E2E_ENV]: "true" }));
  const demoId = crypto.randomUUID();
  await store.createContent({
    id: demoId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-demo",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  });
  const row = await store.getContent(demoId);
  assert.ok(row);
  assert.throws(() => assertPlannerE2eApproveAllowed(row));
});

test("seed and generic content POST are not allowlisted when armed", () => {
  const env = integrationPreview({ [MARKETING_PLANNER_STAGING_E2E_ENV]: "true" });
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation("/api/admin/marketing/seed", "POST", env),
    "deny_allowlist",
  );
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "POST",
      env,
    ),
    "deny_allowlist",
  );
});

test("missing staging Neon project env fails closed", () => {
  const env = integrationPreview({
    [MARKETING_PLANNER_STAGING_E2E_ENV]: "true",
    [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: "",
  });
  assert.equal(isPlannerStagingE2eArmed(env), false);
});

test("disabling E2E mode restores skip on unrelated mutation policy", () => {
  const env = integrationPreview({ [MARKETING_PLANNER_STAGING_E2E_ENV]: "false" });
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/settings",
      "POST",
      env,
    ),
    "scope_unarmed",
  );
  const other = {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/other",
    MARKETING_MOCK_MODE: "true",
    [MARKETING_PLANNER_STAGING_E2E_ENV]: "true",
  };
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/add-to-planner",
      "POST",
      other,
    ),
    "readonly",
  );
  assert.equal(
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/add-to-planner",
      "POST",
      { ...other, MARKETING_PREVIEW_READONLY: "false" },
    ),
    "skip",
  );
});

test("positive classification covers Phase 3 HTTP paths", () => {
  assert.equal(
    isPlannerStagingE2eAllowlistedMutation("/api/admin/marketing/planner/queue", "GET"),
    false,
  );
  assert.equal(
    isPlannerStagingE2eAllowlistedMutation("/api/admin/marketing/plans", "POST"),
    false,
  );
});

test("block messages are stable for middleware", () => {
  assert.match(PLANNER_STAGING_E2E_SCOPE_MESSAGE, /narrow E2E/i);
  assert.match(PLANNER_STAGING_E2E_ALLOWLIST_MESSAGE, /authorized Planner/i);
});