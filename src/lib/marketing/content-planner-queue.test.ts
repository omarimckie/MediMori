import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { publishDue, scheduleApproved } from "./approval";
import { assignContentToWeeklyPlan } from "./content-assign-week";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import {
  addContentToPlanner,
  AddToPlannerError,
  listPlannerQueue,
  removeContentFromPlanner,
} from "./content-planner-queue";
import { marketingDatetimeLocalToIso } from "./marketing-scheduling";
import { SOCIAL_SCHEDULE_TEST_TRACKING_TOKEN } from "./marketing-social-tracking-test-token";
import {
  isMarketingPreviewReadonlyMutationRequest,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "./preview-readonly";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent } from "./types";

function baseContent(overrides: Partial<MarketingContent>): MarketingContent {
  return {
    id: crypto.randomUUID(),
    campaignId: "camp-keep",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
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
    trackingToken: SOCIAL_SCHEDULE_TEST_TRACKING_TOKEN,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedPlan(store: MemoryMarketingStore) {
  const planId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
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
  return planId;
}

async function seedAsset(store: MemoryMarketingStore) {
  await store.createAsset({
    id: "asset-1",
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
}

test("addContentToPlanner requires approved content", async () => {
  const store = new MemoryMarketingStore();
  const row = baseContent({ id: "c-draft", status: "needs_review" });
  await store.createContent(row);
  await assert.rejects(
    () => addContentToPlanner(store, { contentIds: ["c-draft"] }),
    (error: unknown) => error instanceof AddToPlannerError && error.code === "not_approved",
  );
});

test("addContentToPlanner is idempotent and preserves weekly plan", async () => {
  const store = new MemoryMarketingStore();
  const planId = await seedPlan(store);
  const row = baseContent({ id: "c-1", weeklyPlanId: planId });
  await store.createContent(row);
  const first = await addContentToPlanner(store, { contentIds: ["c-1"] }, () => "2026-04-01T00:00:00.000Z");
  assert.equal(first.queued.length, 1);
  assert.equal(first.alreadyQueued.length, 0);
  assert.equal(first.queued[0]?.metadata.plannerQueuedAt, "2026-04-01T00:00:00.000Z");
  const second = await addContentToPlanner(store, { contentIds: ["c-1"] }, () => "2026-04-02T00:00:00.000Z");
  assert.equal(second.queued.length, 0);
  assert.equal(second.alreadyQueued.length, 1);
  const loaded = await store.getContent("c-1");
  assert.equal(loaded?.weeklyPlanId, planId);
  assert.equal(loaded?.metadata.plannerQueuedAt, "2026-04-01T00:00:00.000Z");
});

test("duplicate enqueue under concurrent requests", async () => {
  const store = new MemoryMarketingStore();
  const row = baseContent({ id: "c-conc" });
  await store.createContent(row);
  const fixedNow = () => "2026-04-01T00:00:00.000Z";
  const results = await Promise.all(
    Array.from({ length: 8 }, () => addContentToPlanner(store, { contentIds: ["c-conc"] }, fixedNow)),
  );
  const queued = results.filter((result) => result.queued.length === 1).length;
  const already = results.filter((result) => result.alreadyQueued.length === 1).length;
  assert.equal(queued, 1);
  assert.equal(already, 7);
});

test("legacy approved unscheduled content appears in planner queue list", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(baseContent({ id: "legacy-1" }));
  const queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
  assert.ok(queue.content.some((item) => item.id === "legacy-1"));
  assert.ok(queue.total >= 1);
});

test("remove from planner hides legacy content without clearing week", async () => {
  const store = new MemoryMarketingStore();
  const planId = await seedPlan(store);
  await store.createContent(baseContent({ id: "legacy-2", weeklyPlanId: planId }));
  const removed = await removeContentFromPlanner(store, { contentIds: ["legacy-2"] });
  assert.equal(removed.removed[0]?.weeklyPlanId, planId);
  const queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
  assert.equal(
    queue.content.some((item) => item.id === "legacy-2"),
    false,
  );
});

test("scheduled publication blocks enqueue", async () => {
  const store = new MemoryMarketingStore();
  await seedAsset(store);
  const row = baseContent({ id: "c-blocked" });
  await store.createContent(row);
  await store.createPublication({
    id: crypto.randomUUID(),
    contentId: "c-blocked",
    campaignId: null,
    platform: "instagram",
    provider: "meta",
    status: "scheduled",
    idempotencyKey: "pub:c-blocked:instagram",
    externalId: null,
    url: null,
    scheduledFor: "2026-05-01T12:00:00.000Z",
    attemptCount: 0,
    lastError: null,
    publishedAt: null,
  });
  await assert.rejects(
    () => addContentToPlanner(store, { contentIds: ["c-blocked"] }),
    (error: unknown) => error instanceof AddToPlannerError && error.code === "blocked_publication",
  );
});

test("add to planner creates no publications", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(baseContent({ id: "c-nopub" }));
  await addContentToPlanner(store, { contentIds: ["c-nopub"] });
  assert.equal((await store.listPublications()).length, 0);
});

test("smart upload grouping enqueues paired platforms", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "finalize-pair";
  const ig = baseContent({
    id: "ig-pair",
    platform: "instagram",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: finalizeKey },
  });
  const fb = baseContent({
    id: "fb-pair",
    platform: "facebook",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: finalizeKey },
  });
  await store.createContent(ig);
  await store.createContent(fb);
  const result = await addContentToPlanner(store, { contentIds: ["ig-pair"] });
  assert.equal(result.queued.length, 2);
  const queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
  assert.ok(queue.content.some((item) => item.id === "ig-pair"));
  assert.ok(queue.content.some((item) => item.id === "fb-pair"));
});

test("week assignment after enqueue preserves planner metadata", async () => {
  const store = new MemoryMarketingStore();
  const planId = await seedPlan(store);
  await store.createContent(baseContent({ id: "c-week" }));
  await addContentToPlanner(store, { contentIds: ["c-week"] });
  await assignContentToWeeklyPlan(store, { contentIds: ["c-week"], weeklyPlanId: planId });
  const loaded = await store.getContent("c-week");
  assert.equal(loaded?.weeklyPlanId, planId);
  assert.ok(loaded?.metadata.plannerQueuedAt);
});

test("scheduling after enqueue creates publication only on schedule", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedAsset(store);
  await store.createContent(baseContent({ id: "c-schedule" }));
  await addContentToPlanner(store, { contentIds: ["c-schedule"] });
  assert.equal((await store.listPublications()).length, 0);
  const when = marketingDatetimeLocalToIso("2026-05-20T09:15", "America/New_York");
  await scheduleApproved(store, "c-schedule", { scheduledFor: when });
  assert.equal((await store.listPublications()).length, 1);
  const queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
  assert.equal(
    queue.content.some((item) => item.id === "c-schedule"),
    false,
  );
});

test("historical published publication preserved after enqueue attempt blocked", async () => {
  const store = new MemoryMarketingStore();
  const row = baseContent({ id: "c-published" });
  await store.createContent(row);
  await store.createPublication({
    id: crypto.randomUUID(),
    contentId: "c-published",
    campaignId: null,
    platform: "instagram",
    provider: "meta",
    status: "published",
    idempotencyKey: "pub:c-published:instagram",
    externalId: "meta-1",
    url: null,
    scheduledFor: "2026-03-01T12:00:00.000Z",
    attemptCount: 1,
    lastError: null,
    publishedAt: "2026-03-01T12:05:00.000Z",
    providerCreationId: "meta-1",
  });
  await assert.rejects(() => addContentToPlanner(store, { contentIds: ["c-published"] }));
  const pubs = await store.listPublications();
  assert.equal(pubs.length, 1);
  assert.equal(pubs[0]?.status, "published");
});

test("tracking token unchanged by planner enqueue", async () => {
  const store = new MemoryMarketingStore();
  const row = baseContent({ id: "c-track", trackingToken: "track-abc" });
  await store.createContent(row);
  await addContentToPlanner(store, { contentIds: ["c-track"] });
  assert.equal((await store.getContent("c-track"))?.trackingToken, "track-abc");
});

test("publishDue unchanged for queued-only content", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createContent(baseContent({ id: "c-cron" }));
  await addContentToPlanner(store, { contentIds: ["c-cron"] });
  const results = await publishDue(store, new Date("2099-01-01T00:00:00.000Z"));
  assert.equal(results.length, 0);
});

test("preview read-only blocks planner mutations", () => {
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/content/add-to-planner", "POST"),
    true,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest(
      "/api/admin/marketing/content/remove-from-planner",
      "POST",
    ),
    true,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/planner/queue", "GET"),
    false,
  );
  assert.match(MARKETING_PREVIEW_READONLY_MESSAGE, /read-only/i);
});

test("route modules export handlers", () => {
  const addRoute = readFileSync(
    new URL("../../app/api/admin/marketing/content/add-to-planner/route.ts", import.meta.url),
    "utf8",
  );
  const queueRoute = readFileSync(
    new URL("../../app/api/admin/marketing/planner/queue/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(addRoute, /addContentToPlanner/);
  assert.match(addRoute, /requireMarketingAdminMutation/);
  assert.match(queueRoute, /listPlannerQueue/);
  assert.match(queueRoute, /requireMarketingAdmin/);
});
