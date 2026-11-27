import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import { createPlannerE2eStagingFixtures } from "./planner-e2e-fixtures";
import { cleanupPlannerE2eStagingFixtures } from "./planner-e2e-cleanup";
import {
  integrationBranchPlannerStagingRef,
  MARKETING_PLANNER_STAGING_E2E_ENV,
  PLANNER_E2E_STAGING_TAG,
} from "./planner-staging-e2e-gate";
import { MARKETING_STAGING_NEON_PROJECT_ID_ENV } from "./staging-planner-db-guard";

const ORIGINAL = { ...process.env };

function armIntegrationStaging() {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = integrationBranchPlannerStagingRef();
  process.env.MARKETING_MOCK_MODE = "true";
  process.env.MARKETING_PREVIEW_READONLY = "false";
  process.env[MARKETING_STAGING_NEON_PROJECT_ID_ENV] = "small-frost-27394379";
  process.env[MARKETING_PLANNER_STAGING_E2E_ENV] = "true";
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

test("cleanup removes batch-owned fixtures idempotently", async () => {
  armIntegrationStaging();
  const store = new MemoryMarketingStore();
  const created = await createPlannerE2eStagingFixtures(store);
  const first = await cleanupPlannerE2eStagingFixtures(store, { batchId: created.batchId });
  assert.equal(first.deletedContentIds.length, 9);
  const second = await cleanupPlannerE2eStagingFixtures(store, { batchId: created.batchId });
  assert.equal(second.deletedContentIds.length, 0);
  const campaigns = await store.listCampaigns();
  assert.equal(
    campaigns.filter((c) => c.name.includes(PLANNER_E2E_STAGING_TAG)).length,
    0,
  );
});

test("cleanup does not remove untagged staging-like content", async () => {
  armIntegrationStaging();
  const store = new MemoryMarketingStore();
  const foreignId = crypto.randomUUID();
  await store.createContent({
    id: foreignId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "real",
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
    trackingToken: "tok-foreign",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
  });
  const created = await createPlannerE2eStagingFixtures(store);
  await cleanupPlannerE2eStagingFixtures(store, { batchId: created.batchId });
  assert.ok(await store.getContent(foreignId));
});