import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import {
  createPlannerE2eStagingFixtures,
  rejectClientSuppliedE2eOwnership,
} from "./planner-e2e-fixtures";
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

test("fixtures create server-tagged disposable matrix", async () => {
  armIntegrationStaging();
  const store = new MemoryMarketingStore();
  const created = await createPlannerE2eStagingFixtures(store);
  for (const id of Object.values(created.contentIds)) {
    const row = await store.getContent(id);
    assert.ok(row);
    assert.equal((row.metadata as Record<string, unknown>).e2eTag, PLANNER_E2E_STAGING_TAG);
    assert.equal(
      (row.metadata as Record<string, unknown>).e2eFixtureBatch,
      created.batchId,
    );
  }
  const ig = await store.getContent(created.contentIds.instagram);
  assert.equal((ig?.metadata as Record<string, unknown> | undefined)?.utmCampaign, "e2e-planner");
});

test("fixtures blocked when E2E mode is unarmed", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = integrationBranchPlannerStagingRef();
  const store = new MemoryMarketingStore();
  await assert.rejects(() => createPlannerE2eStagingFixtures(store));
});

test("client cannot self-assign e2eTag via metadata patch", () => {
  assert.throws(() => rejectClientSuppliedE2eOwnership({ e2eTag: PLANNER_E2E_STAGING_TAG }));
  assert.doesNotThrow(() =>
    rejectClientSuppliedE2eOwnership(
      { e2eTag: PLANNER_E2E_STAGING_TAG, plannerQueuedAt: "t" },
      { e2eTag: PLANNER_E2E_STAGING_TAG },
    ),
  );
});