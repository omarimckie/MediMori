import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approveContent,
  publishDue,
  publishPublication,
  scheduleApproved,
} from "./approval";
import { executeMarketingContentPostAction } from "./content-post-action";
import {
  calendarDayKeyInMarketingTimezone,
  marketingDatetimeLocalToIso,
} from "./marketing-scheduling";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent } from "./types";

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "content-1",
    campaignId: "camp-1",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Post",
    body: "Body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: "2026-04-01T14:00:00.000Z",
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  const content = sampleContent({ assetIds: ["asset-1"] });
  await store.createContent(content);
  return content;
}

test("scheduleApproved persists selected scheduledFor on content and publication", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  const selected = marketingDatetimeLocalToIso("2026-05-20T09:15", "America/New_York");
  const publication = await scheduleApproved(store, content.id, { scheduledFor: selected });
  const refreshed = await store.getContent(content.id);
  assert.equal(refreshed?.status, "scheduled");
  assert.equal(refreshed?.scheduledFor, selected);
  assert.equal(publication.scheduledFor, selected);
});

test("scheduleApproved reuses existing publication row", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  const first = await scheduleApproved(store, content.id, {
    scheduledFor: "2026-05-01T12:00:00.000Z",
  });
  const second = await scheduleApproved(store, content.id, {
    scheduledFor: "2026-05-02T12:00:00.000Z",
  });
  assert.equal(first.id, second.id);
  assert.equal((await store.listPublications()).length, 1);
  assert.equal(second.scheduledFor, "2026-05-02T12:00:00.000Z");
});

test("future scheduled publication is not claimable or publishable early", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const publication = await scheduleApproved(store, content.id, { scheduledFor: future });
  assert.equal(await store.claimPublication(publication.id), null);
  const unchanged = await publishPublication(store, publication);
  assert.equal(unchanged.status, "scheduled");
  await publishDue(store);
  const afterDue = await store.getPublication(publication.id);
  assert.equal(afterDue?.status, "scheduled");
});

test("due scheduled publication can be claimed and published", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  const past = new Date(Date.now() - 60_000).toISOString();
  const publication = await scheduleApproved(store, content.id, { scheduledFor: past });
  const claimed = await store.claimPublication(publication.id);
  assert.ok(claimed);
  const published = await publishPublication(store, claimed);
  assert.equal(published.status, "published");
  assert.ok(published.publishedAt);
  const refreshed = await store.getContent(content.id);
  assert.equal(refreshed?.status, "published");
  assert.equal(refreshed?.scheduledFor, past);
});

test("calendar groups published items by scheduledFor in marketing timezone", () => {
  const iso = "2026-03-10T03:30:00.000Z";
  const key = calendarDayKeyInMarketingTimezone(iso, "America/New_York");
  assert.equal(key, "2026-03-09");
});

test("schedule API rejects invalid schedule time", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  await approveContent(store, content.id, "owner");
  const response = await executeMarketingContentPostAction(store, {
    action: "schedule",
    contentId: content.id,
    scheduledFor: "not-valid",
    actor: "owner",
  });
  assert.equal(response.status, 400);
});
