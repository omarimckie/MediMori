import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createPlannerE2eStagingFixtures } from "./planner-e2e-fixtures";
import { cleanupPlannerE2eStagingFixtures } from "./planner-e2e-cleanup";
import { exercisePlannerE2eTikTokMockPublish } from "./planner-e2e-tiktok-flow";
import {
  integrationBranchPlannerStagingRef,
  MARKETING_PLANNER_STAGING_E2E_ENV,
} from "./planner-staging-e2e-gate";
import { MARKETING_STAGING_NEON_PROJECT_ID_ENV } from "./staging-planner-db-guard";
import { MemoryMarketingStore } from "./memory-store";

const ORIGINAL = { ...process.env };

function armIntegrationStaging() {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = integrationBranchPlannerStagingRef();
  process.env.MARKETING_MOCK_MODE = "true";
  process.env.MARKETING_PREVIEW_READONLY = "false";
  process.env.MARKETING_BUFFER_TIKTOK_ENABLED = "true";
  process.env[MARKETING_STAGING_NEON_PROJECT_ID_ENV] = "small-frost-27394379";
  process.env[MARKETING_PLANNER_STAGING_E2E_ENV] = "true";
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

test("tiktok fixtures schedule and mock publish through publisher path", async () => {
  armIntegrationStaging();
  const store = new MemoryMarketingStore();
  const fixtures = await createPlannerE2eStagingFixtures(store);
  const pubsBefore = (await store.listPublications()).length;

  const result = await exercisePlannerE2eTikTokMockPublish(store, fixtures);
  assert.ok(result.imageExternalId?.includes("mock_buffer"));
  assert.ok(result.videoExternalId?.includes("mock_buffer"));

  const pubsAfter = await store.listPublications();
  assert.equal(pubsAfter.length, pubsBefore + 2);

  const imagePub = await store.getPublication(result.imagePublicationId);
  assert.ok(imagePub?.externalId);
  assert.ok(
    imagePub.status === "processing" ||
      imagePub.status === "scheduled" ||
      imagePub.status === "published",
  );

  const cleanup = await cleanupPlannerE2eStagingFixtures(store, { batchId: fixtures.batchId });
  assert.equal(cleanup.deletedContentIds.length, 9);
});