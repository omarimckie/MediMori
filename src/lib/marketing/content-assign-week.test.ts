import assert from "node:assert/strict";
import { test } from "node:test";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import {
  assignContentToWeeklyPlan,
  AssignContentToWeekError,
  resolveSmartUploadPairForContent,
} from "./content-assign-week";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent } from "./types";

async function seedPlan(store: MemoryMarketingStore) {
  const campaignId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  await store.createCampaign({
    id: campaignId,
    name: "Test",
    objective: "Test",
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
      objective: "Test",
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
  return { planId, campaignId };
}

function baseContent(overrides: Partial<MarketingContent>): MarketingContent {
  return {
    id: crypto.randomUUID(),
    campaignId: "camp-keep",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "Title",
    body: "Body text",
    cta: "Shop now",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedSmartUploadPair(store: MemoryMarketingStore, finalizeKey: string) {
  const assetId = crypto.randomUUID();
  await store.createAsset({
    id: assetId,
    name: "pair.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: ["smart_upload"],
    url: "https://example.test/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    altText: "alt",
    isDemo: true,
  });
  const ig = baseContent({
    id: crypto.randomUUID(),
    platform: "instagram",
    assetIds: [assetId],
    metadata: {
      source: SMART_UPLOAD_SOURCE,
      smartUploadFinalizeKey: finalizeKey,
      batchId: "batch-1",
    },
  });
  const fb = baseContent({
    id: crypto.randomUUID(),
    platform: "facebook",
    assetIds: [assetId],
    metadata: {
      source: SMART_UPLOAD_SOURCE,
      smartUploadFinalizeKey: finalizeKey,
      batchId: "batch-1",
    },
  });
  await store.createContent(ig);
  await store.createContent(fb);
  return { ig, fb, assetId };
}

test("assignContentToWeeklyPlan persists weeklyPlanId in memory store", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const row = baseContent({ id: "c-1", campaignId: "camp-keep" });
  await store.createContent(row);
  const result = await assignContentToWeeklyPlan(store, {
    contentIds: ["c-1"],
    weeklyPlanId: planId,
  });
  assert.equal(result.updated.length, 1);
  assert.equal(result.updated[0]?.weeklyPlanId, planId);
  const loaded = await store.getContent("c-1");
  assert.equal(loaded?.weeklyPlanId, planId);
});

test("assignment does not change status campaign body cta or assets", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const row = baseContent({
    id: "c-2",
    campaignId: "camp-keep",
    status: "needs_review",
    body: "Keep body",
    cta: "Keep CTA",
    assetIds: ["asset-1"],
  });
  await store.createContent(row);
  await assignContentToWeeklyPlan(store, { contentIds: ["c-2"], weeklyPlanId: planId });
  const loaded = await store.getContent("c-2");
  assert.equal(loaded?.status, "needs_review");
  assert.equal(loaded?.campaignId, "camp-keep");
  assert.equal(loaded?.body, "Keep body");
  assert.equal(loaded?.cta, "Keep CTA");
  assert.deepEqual(loaded?.assetIds, ["asset-1"]);
});

test("assignment creates no publication", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const row = baseContent({ id: "c-3" });
  await store.createContent(row);
  await assignContentToWeeklyPlan(store, { contentIds: ["c-3"], weeklyPlanId: planId });
  const pubs = await store.listPublications();
  assert.equal(pubs.length, 0);
});

test("reassigning same plan is idempotent", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const row = baseContent({ id: "c-4" });
  await store.createContent(row);
  await assignContentToWeeklyPlan(store, { contentIds: ["c-4"], weeklyPlanId: planId });
  await assignContentToWeeklyPlan(store, { contentIds: ["c-4"], weeklyPlanId: planId });
  assert.equal((await store.getContent("c-4"))?.weeklyPlanId, planId);
});

test("changing week updates weeklyPlanId only", async () => {
  const store = new MemoryMarketingStore();
  const { planId: planA } = await seedPlan(store);
  const planB = crypto.randomUUID();
  await store.createWeeklyPlan({
    id: planB,
    campaignId: (await store.listWeeklyPlans())[0]!.campaignId!,
    weekStart: "2026-04-14",
    status: "ready",
    summary: {
      itemCount: 0,
      newAssetCount: 0,
      warningCount: 0,
      objective: "Test",
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
  const row = baseContent({ id: "c-5", campaignId: "camp-keep" });
  await store.createContent(row);
  await assignContentToWeeklyPlan(store, { contentIds: ["c-5"], weeklyPlanId: planA });
  await assignContentToWeeklyPlan(store, { contentIds: ["c-5"], weeklyPlanId: planB });
  const loaded = await store.getContent("c-5");
  assert.equal(loaded?.weeklyPlanId, planB);
  assert.equal(loaded?.campaignId, "camp-keep");
});

test("invalid plan rejected", async () => {
  const store = new MemoryMarketingStore();
  const row = baseContent({ id: "c-6" });
  await store.createContent(row);
  await assert.rejects(
    () =>
      assignContentToWeeklyPlan(store, {
        contentIds: ["c-6"],
        weeklyPlanId: crypto.randomUUID(),
      }),
    (error: unknown) => error instanceof AssignContentToWeekError && error.code === "plan_not_found",
  );
});

test("invalid content id rejected", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  await assert.rejects(
    () =>
      assignContentToWeeklyPlan(store, {
        contentIds: ["missing"],
        weeklyPlanId: planId,
      }),
    (error: unknown) => error instanceof AssignContentToWeekError && error.code === "content_not_found",
  );
});

test("empty contentIds rejected", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  await assert.rejects(
    () => assignContentToWeeklyPlan(store, { contentIds: [], weeklyPlanId: planId }),
    (error: unknown) => error instanceof AssignContentToWeekError && error.code === "invalid_input",
  );
});

test("complete Smart Upload pair identified", async () => {
  const store = new MemoryMarketingStore();
  const key = crypto.randomUUID();
  const { ig, fb } = await seedSmartUploadPair(store, key);
  const pair = await resolveSmartUploadPairForContent(store, ig);
  assert.equal(pair.kind, "complete");
  if (pair.kind === "complete") {
    assert.equal(pair.instagramId, ig.id);
    assert.equal(pair.facebookId, fb.id);
  }
});

test("IG-only assignment", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const key = crypto.randomUUID();
  const { ig, fb } = await seedSmartUploadPair(store, key);
  await assignContentToWeeklyPlan(store, { contentIds: [ig.id], weeklyPlanId: planId });
  assert.equal((await store.getContent(ig.id))?.weeklyPlanId, planId);
  assert.equal((await store.getContent(fb.id))?.weeklyPlanId, null);
});

test("FB-only assignment", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const key = crypto.randomUUID();
  const { ig, fb } = await seedSmartUploadPair(store, key);
  await assignContentToWeeklyPlan(store, { contentIds: [fb.id], weeklyPlanId: planId });
  assert.equal((await store.getContent(fb.id))?.weeklyPlanId, planId);
  assert.equal((await store.getContent(ig.id))?.weeklyPlanId, null);
});

test("both-platform assignment", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await seedPlan(store);
  const key = crypto.randomUUID();
  const { ig, fb } = await seedSmartUploadPair(store, key);
  await assignContentToWeeklyPlan(store, { contentIds: [ig.id, fb.id], weeklyPlanId: planId });
  assert.equal((await store.getContent(ig.id))?.weeklyPlanId, planId);
  assert.equal((await store.getContent(fb.id))?.weeklyPlanId, planId);
});

test("incomplete pair handled safely", async () => {
  const store = new MemoryMarketingStore();
  const key = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  await store.createAsset({
    id: assetId,
    name: "partial.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
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
    url: "https://example.test/marketing/public/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
    altText: "alt",
    isDemo: true,
  });
  const ig = baseContent({
    platform: "instagram",
    assetIds: [assetId],
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: key },
  });
  await store.createContent(ig);
  const pair = await resolveSmartUploadPairForContent(store, ig);
  assert.equal(pair.kind, "partial_or_inconsistent");
});
