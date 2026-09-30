import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approveContent,
  publishPublication,
  scheduleApproved,
} from "./approval";
import { calendarAddExistingEligibility } from "./calendar-add-existing-eligibility";
import { executeMarketingContentPostAction } from "./content-post-action";
import {
  listMarketingCalendarEvents,
} from "./marketing-calendar";
import {
  marketingDatetimeLocalToIso,
} from "./marketing-scheduling";
import { MemoryMarketingStore } from "./memory-store";
import {
  recycleIdempotencyKey,
  recyclePublished,
} from "./recycle";
import type { MarketingContent } from "./types";

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "content-1",
    campaignId: "camp-1",
    weeklyPlanId: "plan-other",
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Sickle Cell Tips",
    body: "Body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: "2026-09-10T16:00:00.000Z",
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedSchedulableContent(store: MemoryMarketingStore) {
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
    isDemo: false,
  });
  const content = sampleContent();
  await store.createContent(content);
  return content;
}

test("listContent without weeklyPlanId returns all marketing content", async () => {
  const store = new MemoryMarketingStore();
  await seedSchedulableContent(store);
  await store.createContent(
    sampleContent({
      id: "content-2",
      weeklyPlanId: "plan-current",
      title: "Other plan post",
    }),
  );
  const all = await store.listContent();
  assert.equal(all.length, 2);
  const filtered = await store.listContent({ weeklyPlanId: "plan-current" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "content-2");
});

test("scheduling approved content via content action creates scheduled publication", async () => {
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  await approveContent(store, content.id, "owner");
  const when = marketingDatetimeLocalToIso("2026-10-06T10:00", "America/New_York");
  const response = await executeMarketingContentPostAction(store, {
    action: "schedule",
    contentId: content.id,
    scheduledFor: when,
  });
  assert.equal(response.status, 200);
  const publications = await store.listPublications("scheduled");
  assert.equal(publications.length, 1);
  assert.equal(publications[0]?.scheduledFor, when);
});

test("failed publication reschedules via schedule action when content is approved", async () => {
  const store = new MemoryMarketingStore();
  process.env.MARKETING_MOCK_MODE = "true";
  const content = await seedSchedulableContent(store);
  await approveContent(store, content.id, "owner");
  const first = await scheduleApproved(store, content.id, {
    scheduledFor: new Date(Date.now() - 86400000).toISOString(),
  });
  await store.updatePublication(first.id, {
    status: "failed",
    lastError: "simulated",
  });
  await store.updateContent(content.id, { status: "approved" });
  const when = marketingDatetimeLocalToIso("2026-10-07T11:00", "America/New_York");
  const updated = await scheduleApproved(store, content.id, { scheduledFor: when });
  assert.equal(updated.id, first.id);
  assert.equal(updated.status, "scheduled");
  assert.equal(updated.scheduledFor, when);
  assert.equal(updated.lastError, null);
});

test("two recycle schedules create independent publications and calendar events", async () => {
  const store = new MemoryMarketingStore();
  process.env.MARKETING_MOCK_MODE = "true";
  const content = await seedSchedulableContent(store);
  await approveContent(store, content.id, "owner");
  const original = await scheduleApproved(store, content.id, {
    scheduledFor: new Date(Date.now() - 7 * 86400000).toISOString(),
  });
  await publishPublication(store, original);
  const monday = marketingDatetimeLocalToIso("2026-10-06T09:00", "America/New_York");
  const friday = marketingDatetimeLocalToIso("2026-10-10T15:00", "America/New_York");
  const recycleA = await recyclePublished(store, content.id, { scheduledFor: monday });
  assert.equal((await store.getContent(content.id))?.status, "scheduled");
  const recycleB = await recyclePublished(store, content.id, { scheduledFor: friday });
  assert.notEqual(recycleA.id, recycleB.id);
  assert.notEqual(recycleA.idempotencyKey, recycleB.idempotencyKey);
  assert.notEqual(recycleA.idempotencyKey, original.idempotencyKey);
  assert.equal(recycleA.idempotencyKey, recycleIdempotencyKey(content, recycleA.id));
  assert.equal(recycleB.idempotencyKey, recycleIdempotencyKey(content, recycleB.id));

  const events = await listMarketingCalendarEvents(store);
  const forContent = events.filter((e) => e.contentId === content.id);
  assert.equal(forContent.length, 2);
  const times = forContent.map((e) => e.scheduledFor).sort();
  assert.deepEqual(times, [monday, friday].sort());
});

test("recycle content action uses recycle path for published content", async () => {
  const store = new MemoryMarketingStore();
  process.env.MARKETING_MOCK_MODE = "true";
  const content = await seedSchedulableContent(store);
  await approveContent(store, content.id, "owner");
  const pub = await scheduleApproved(store, content.id, {
    scheduledFor: new Date(Date.now() - 86400000).toISOString(),
  });
  await publishPublication(store, pub);
  const when = marketingDatetimeLocalToIso("2026-10-08T12:00", "America/New_York");
  const response = await executeMarketingContentPostAction(store, {
    action: "recycle",
    contentId: content.id,
    scheduledFor: when,
  });
  assert.equal(response.status, 200);
  const scheduled = await store.listPublications("scheduled");
  assert.equal(scheduled.length, 1);
  assert.match(scheduled[0]?.idempotencyKey ?? "", /:recycle:/);
});

test("calendar eligibility aligns with published recycle API path", () => {
  const eligible = calendarAddExistingEligibility({
    status: "published",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: true,
  });
  assert.equal(eligible.eligible, true);
  if (eligible.eligible) assert.equal(eligible.mode, "recycle");
});
