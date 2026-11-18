import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";
import { resetSqlCacheForTests, setSqlFactoryForTests } from "@/lib/db";
import { createDisposableMarketingPgSql } from "./marketing-disposable-pg-sql";
import { assignContentToWeeklyPlan } from "./content-assign-week";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import {
  addContentToPlanner,
  listPlannerQueue,
  removeContentFromPlanner,
} from "./content-planner-queue";
import { marketingDatetimeLocalToIso } from "./marketing-scheduling";
import { SOCIAL_SCHEDULE_TEST_TRACKING_TOKEN } from "./marketing-social-tracking-test-token";
import { scheduleApproved } from "./approval";
import { parseMarketingPublicationAmbiguityMigrationStatements } from "../../../scripts/apply-marketing-publication-ambiguity-schema.mjs";
import { PostgresMarketingStore } from "./postgres-store";
import type { MarketingContent } from "./types";

const marketingSqlPath = fileURLToPath(new URL("../../../sql/marketing.sql", import.meta.url));
const publicationAmbiguitySqlPath = fileURLToPath(
  new URL("../../../sql/marketing-publication-ambiguity.sql", import.meta.url),
);

const testDbUrl = process.env.MARKETING_PLANNER_TEST_DATABASE_URL?.trim() ?? "";

let disposablePool: pg.Pool | null = null;

async function applyMarketingSchema(pool: pg.Pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  const file = readFileSync(marketingSqlPath, "utf8");
  const statements = file
    .split(/;\s*\n/)
    .map((part) => part.replace(/^(\s*--[^\n]*\n)+/m, "").trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) {
    await pool.query(statement);
  }
}

function contentInput(overrides: Partial<MarketingContent> & { id?: string }): Omit<
  MarketingContent,
  "createdAt" | "updatedAt"
> {
  const id = overrides.id ?? crypto.randomUUID();
  const base: Omit<MarketingContent, "createdAt" | "updatedAt"> = {
    id,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Planner postgres test",
    body: "Body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: `${SOCIAL_SCHEDULE_TEST_TRACKING_TOKEN}-${id.slice(0, 8)}`,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  };
  return { ...base, ...overrides, id: overrides.id ?? id };
}

async function seedWeeklyPlan(store: PostgresMarketingStore) {
  const campaignId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  await store.createCampaign({
    id: campaignId,
    name: "PG planner",
    objective: "test",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "x",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta: null,
    requiredAssets: [],
    measurementGoals: [],
    bookIds: [],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: true,
  });
  await store.createWeeklyPlan({
    id: planId,
    campaignId,
    weekStart: "2026-04-07",
    status: "ready",
    summary: {
      itemCount: 0,
      newAssetCount: 0,
      warningCount: 0,
      objective: "test",
      audience: "parents",
      quotas: {
        instagram: 1,
        facebook: 1,
        pinterest: 0,
        email: 0,
        website: 0,
        google: 0,
      },
    },
    rationale: {},
    isDemo: true,
  });
  return planId;
}

describe("content planner queue (disposable PostgreSQL)", { skip: !testDbUrl }, () => {
  before(async () => {
    process.env.DATABASE_URL = testDbUrl;
    disposablePool = new pg.Pool({ connectionString: testDbUrl, ssl: false });
    resetSqlCacheForTests();
    setSqlFactoryForTests(() => createDisposableMarketingPgSql(disposablePool!));
    await applyMarketingSchema(disposablePool);
    const ambiguityStatements = parseMarketingPublicationAmbiguityMigrationStatements(
      readFileSync(publicationAmbiguitySqlPath, "utf8"),
    );
    for (const statement of ambiguityStatements) {
      await disposablePool.query(statement);
    }
  });

  after(async () => {
    await disposablePool?.end();
    disposablePool = null;
    resetSqlCacheForTests();
  });

  beforeEach(async () => {
    if (!disposablePool) return;
    await disposablePool.query(`
      TRUNCATE marketing_publications, marketing_approvals, marketing_content,
        marketing_weekly_plans, marketing_campaigns, marketing_assets
      RESTART IDENTITY CASCADE
    `);
  });

  it("persists enqueue metadata in JSONB and lists queue with pagination and platform filter", async () => {
    process.env.DATABASE_URL = testDbUrl;
    const store = new PostgresMarketingStore();
    const igId = crypto.randomUUID();
    const fbId = crypto.randomUUID();
    await store.createContent(
      contentInput({
        id: igId,
        platform: "instagram",
        metadata: { seedTag: "planner-pg", foo: 1 } as unknown as MarketingContent["metadata"],
      }),
    );
    await store.createContent(contentInput({ id: fbId, platform: "facebook" }));
    const enqueue = await addContentToPlanner(
      store,
      { contentIds: [igId] },
      () => "2026-04-02T12:00:00.000Z",
    );
    assert.equal(enqueue.queued.length, 1);
    const loaded = await store.getContent(igId);
    assert.equal(loaded?.metadata.plannerQueuedAt, "2026-04-02T12:00:00.000Z");
    const metadata = loaded?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.seedTag, "planner-pg");
    assert.equal(metadata?.foo, 1);

    const legacyQueue = await listPlannerQueue(store, { limit: 50, offset: 0 });
    assert.ok(legacyQueue.content.some((row) => row.id === fbId));
    const igPage = await listPlannerQueue(store, { limit: 1, offset: 0, platform: "instagram" });
    assert.equal(igPage.content.length, 1);
    assert.equal(igPage.content[0]?.id, igId);
    assert.ok(igPage.total >= 1);
  });

  it("remove and re-add preserves week assignment and hides then restores queue membership", async () => {
    process.env.DATABASE_URL = testDbUrl;
    const store = new PostgresMarketingStore();
    const planId = await seedWeeklyPlan(store);
    const contentId = crypto.randomUUID();
    await store.createContent(contentInput({ id: contentId, weeklyPlanId: planId }));
    await addContentToPlanner(store, { contentIds: [contentId] });
    const removed = await removeContentFromPlanner(store, { contentIds: [contentId] });
    assert.equal(removed.removed[0]?.weeklyPlanId, planId);
    let queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
    assert.equal(
      queue.content.some((row) => row.id === contentId),
      false,
    );
    await addContentToPlanner(store, { contentIds: [contentId] }, () => "2026-04-03T00:00:00.000Z");
    queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
    assert.ok(queue.content.some((row) => row.id === contentId));
  });

  it("enqueue does not create publications; schedule creates one", async () => {
    process.env.DATABASE_URL = testDbUrl;
    process.env.MARKETING_MOCK_MODE = "true";
    const store = new PostgresMarketingStore();
    const contentId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    await store.createAsset({
      id: assetId,
      name: "img",
      type: "upload",
      source: "manual_upload",
      bookId: null,
      characterId: null,
      campaignId: null,
      approved: true,
      usageRestrictions: null,
      aspectRatio: "1:1",
      imageWidth: 1080,
      imageHeight: 1080,
      mimeType: "image/png",
      tags: [],
      url: "https://cdn.example.test/post.png",
      altText: "x",
      isDemo: true,
    });
    await store.createContent(contentInput({ id: contentId, assetIds: [assetId] }));
    await addContentToPlanner(store, { contentIds: [contentId] });
    assert.equal((await store.listPublications()).length, 0);
    const when = marketingDatetimeLocalToIso("2026-05-20T09:15", "America/New_York");
    await scheduleApproved(store, contentId, { scheduledFor: when });
    assert.equal((await store.listPublications()).length, 1);
    const queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
    assert.equal(
      queue.content.some((row) => row.id === contentId),
      false,
    );
  });

  it("concurrent enqueue across separate store instances leaves single plannerQueuedAt", async () => {
    process.env.DATABASE_URL = testDbUrl;
    const contentId = crypto.randomUUID();
    const bootstrap = new PostgresMarketingStore();
    await bootstrap.createContent(contentInput({ id: contentId }));
    const fixedNow = () => "2026-04-04T00:00:00.000Z";
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        addContentToPlanner(new PostgresMarketingStore(), { contentIds: [contentId] }, fixedNow),
      ),
    );
    const queuedCount = results.filter((r) => r.queued.length === 1).length;
    assert.ok(queuedCount >= 1);
    assert.equal(results.reduce((n, r) => n + r.queued.length + r.alreadyQueued.length, 0), 6);
    const loaded = await bootstrap.getContent(contentId);
    assert.ok(loaded?.metadata.plannerQueuedAt);
    assert.equal((await bootstrap.listPublications()).length, 0);
  });

  it("smart upload pairing enqueues both platforms in postgres", async () => {
    process.env.DATABASE_URL = testDbUrl;
    const store = new PostgresMarketingStore();
    const sharedAssetId = crypto.randomUUID();
    const finalizeKey = `finalize-${crypto.randomUUID()}`;
    const igId = crypto.randomUUID();
    const fbId = crypto.randomUUID();
    await store.createContent(
      contentInput({
        id: igId,
        platform: "instagram",
        assetIds: [sharedAssetId],
        metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: finalizeKey },
      }),
    );
    await store.createContent(
      contentInput({
        id: fbId,
        platform: "facebook",
        assetIds: [sharedAssetId],
        metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: finalizeKey },
      }),
    );
    const result = await addContentToPlanner(store, { contentIds: [igId] });
    assert.equal(result.queued.length, 2);
    const queue = await listPlannerQueue(store, { limit: 50, offset: 0, platform: "facebook" });
    assert.ok(queue.content.some((row) => row.id === fbId));
  });
});