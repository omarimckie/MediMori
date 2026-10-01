import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approveContent,
  publishPublication,
  scheduleApproved,
} from "./approval";
import { executeMarketingContentPostAction } from "./content-post-action";
import {
  calendarEventsFromPublications,
  listMarketingCalendarEvents,
} from "./marketing-calendar";
import {
  calendarDayKeyInMarketingTimezone,
  marketingDatetimeLocalToIso,
} from "./marketing-scheduling";
import { MemoryMarketingStore } from "./memory-store";
import { pickPrimaryPublication } from "./publication-selection";
import {
  recycleIdempotencyKey,
  recyclePublished,
} from "./recycle";
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

async function seedPublishedWithOriginalPublication(store: MemoryMarketingStore) {
  process.env.MARKETING_MOCK_MODE = "true";
  const content = await seedSchedulableContent(store);
  await approveContent(store, content.id, "owner");
  const originalScheduled = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const original = await scheduleApproved(store, content.id, { scheduledFor: originalScheduled });
  const published = await publishPublication(store, original);
  assert.equal(published.status, "published");
  assert.equal(published.idempotencyKey, `pub:${content.id}:${content.platform}`);
  return { content, original: published };
}

test("recycle creates a new publication with recycle idempotency key", async () => {
  const store = new MemoryMarketingStore();
  const { content, original } = await seedPublishedWithOriginalPublication(store);
  const recycleTime = marketingDatetimeLocalToIso("2026-09-30T16:00", "America/New_York");
  const recycled = await recyclePublished(store, content.id, { scheduledFor: recycleTime });

  assert.notEqual(recycled.id, original.id);
  assert.match(recycled.idempotencyKey, /^pub:content-1:instagram:recycle:/);
  assert.equal(recycled.idempotencyKey, recycleIdempotencyKey(content, recycled.id));
  assert.notEqual(recycled.idempotencyKey, original.idempotencyKey);
  assert.equal(recycled.status, "scheduled");
  assert.equal(recycled.scheduledFor, recycleTime);
  assert.equal(recycled.publishedAt, null);
  assert.equal(recycled.externalId, null);

  const originalAfter = await store.getPublication(original.id);
  assert.equal(originalAfter?.status, "published");
  assert.equal(originalAfter?.scheduledFor, original.scheduledFor);
  assert.equal(originalAfter?.publishedAt, original.publishedAt);
  assert.equal(originalAfter?.externalId, original.externalId);

  const refreshed = await store.getContent(content.id);
  assert.equal(refreshed?.status, "scheduled");
  assert.equal(refreshed?.scheduledFor, recycleTime);
  assert.equal((await store.listPublications()).length, 2);
});

test("recycle rejects ineligible content", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedSchedulableContent(store);
  await assert.rejects(
    () => recyclePublished(store, content.id, { scheduledFor: "2026-09-30T16:00:00.000Z" }),
    /Only published content can be recycled/,
  );
});

test("recycle does not update original publication via scheduleApproved path", async () => {
  const store = new MemoryMarketingStore();
  const { content, original } = await seedPublishedWithOriginalPublication(store);
  const beforeUpdate = await store.getPublication(original.id);
  await recyclePublished(store, content.id, {
    scheduledFor: "2026-09-30T20:00:00.000Z",
  });
  const after = await store.getPublication(original.id);
  assert.deepEqual(
    {
      status: after?.status,
      scheduledFor: after?.scheduledFor,
      publishedAt: after?.publishedAt,
      externalId: after?.externalId,
      idempotencyKey: after?.idempotencyKey,
    },
    {
      status: beforeUpdate?.status,
      scheduledFor: beforeUpdate?.scheduledFor,
      publishedAt: beforeUpdate?.publishedAt,
      externalId: beforeUpdate?.externalId,
      idempotencyKey: beforeUpdate?.idempotencyKey,
    },
  );
  await assert.rejects(
    () => scheduleApproved(store, content.id, { scheduledFor: "2026-10-01T12:00:00.000Z" }),
    /already published/,
  );
});

test("recycled publication publishes with its own externalId", async () => {
  const store = new MemoryMarketingStore();
  const { content, original } = await seedPublishedWithOriginalPublication(store);
  const past = new Date(Date.now() - 60_000).toISOString();
  const recycled = await recyclePublished(store, content.id, { scheduledFor: past });
  const publishedRecycle = await publishPublication(store, recycled);
  assert.equal(publishedRecycle.status, "published");
  assert.ok(publishedRecycle.externalId);
  assert.notEqual(publishedRecycle.externalId, original.externalId);

  const originalAfter = await store.getPublication(original.id);
  assert.equal(originalAfter?.externalId, original.externalId);
  assert.equal(originalAfter?.publishedAt, original.publishedAt);
});

test("calendar lists recycled publication on publication.scheduledFor", async () => {
  const store = new MemoryMarketingStore();
  const { content, original } = await seedPublishedWithOriginalPublication(store);
  const recycleTime = "2026-09-30T20:00:00.000Z";
  await recyclePublished(store, content.id, { scheduledFor: recycleTime });
  const events = await listMarketingCalendarEvents(store);
  const scheduledEvents = events.filter((event) => event.eventKind === "scheduled");
  assert.equal(scheduledEvents.length, 1);
  assert.equal(scheduledEvents[0]?.scheduledFor, recycleTime);
  assert.equal(
    scheduledEvents[0]?.publicationId,
    (await store.listPublications("scheduled"))[0]?.id,
  );
  assert.equal(events.some((event) => event.eventKind === "published"), true);

  const originalAfter = await store.getPublication(original.id);
  assert.equal(originalAfter?.status, "published");
  const dayKey = calendarDayKeyInMarketingTimezone(recycleTime, content.timezone);
  assert.equal(dayKey, "2026-09-30");
});

test("pickPrimaryPublication prefers scheduled recycle over published original", async () => {
  const store = new MemoryMarketingStore();
  const { content, original } = await seedPublishedWithOriginalPublication(store);
  const recycled = await recyclePublished(store, content.id, {
    scheduledFor: "2026-09-30T20:00:00.000Z",
  });
  const publications = await store.listPublications();
  const primary = pickPrimaryPublication(publications, content.id);
  assert.equal(primary?.id, recycled.id);
  assert.equal(primary?.status, "scheduled");

  const refreshedContent = await store.getContent(content.id);
  assert.ok(refreshedContent);
  const contentMap = new Map<string, MarketingContent>([[content.id, refreshedContent]]);
  const events = calendarEventsFromPublications(publications, contentMap);
  assert.equal(
    events.filter((e) => e.eventKind === "scheduled" && e.publicationId === original.id).length,
    0,
  );
  assert.equal(events.filter((e) => e.eventKind === "published" && e.publicationId === original.id).length, 1);
});

test("recycle API rejects invalid schedule time", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await seedPublishedWithOriginalPublication(store);
  const response = await executeMarketingContentPostAction(store, {
    action: "recycle",
    contentId: content.id,
    scheduledFor: "not-valid",
    actor: "owner",
  });
  assert.equal(response.status, 400);
});

test("first-time schedule regression still reuses original idempotency key", async () => {
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
  assert.equal(first.idempotencyKey, `pub:${content.id}:${content.platform}`);
});
