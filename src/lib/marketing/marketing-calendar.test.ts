import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  approveContent,
  publishPublication,
  scheduleApproved,
} from "./approval";
import {
  calendarDayKeyForEvent,
  calendarEventsFromPublications,
  isRecyclePublicationIdempotencyKey,
  listMarketingCalendarEvents,
} from "./marketing-calendar";
import {
  calendarDayKeyInMarketingTimezone,
  marketingDatetimeLocalToIso,
} from "./marketing-scheduling";
import { MemoryMarketingStore } from "./memory-store";
import { recycleIdempotencyKey, recyclePublished } from "./recycle";
import type { MarketingContent, MarketingPublication } from "./types";

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "content-1",
    campaignId: "camp-1",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "published",
    title: "Sickle Cell",
    body: "Body text for excerpt",
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
    isDemo: false,
  });
}

test("published publication with publishedAt becomes calendar event", () => {
  const content = sampleContent();
  const publishedAt = "2026-09-28T16:00:00.000Z";
  const publication: MarketingPublication = {
    id: "pub-1",
    contentId: content.id,
    campaignId: content.campaignId,
    platform: "instagram",
    provider: "meta",
    status: "published",
    idempotencyKey: `pub:${content.id}:instagram`,
    externalId: "ext-1",
    url: "https://instagram.example/p/1",
    attemptCount: 1,
    scheduledFor: "2026-09-28T14:00:00.000Z",
    publishedAt,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastError: null,
  };
  const events = calendarEventsFromPublications(
    [publication],
    new Map([[content.id, content]]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventKind, "published");
  assert.equal(events[0]?.placementAt, publishedAt);
  assert.equal(events[0]?.canRecycle, true);
});

test("published event day key uses marketing timezone", () => {
  const content = sampleContent({ timezone: "America/New_York" });
  const publishedAt = marketingDatetimeLocalToIso("2026-09-28T21:00", "America/New_York");
  const publication: MarketingPublication = {
    id: "pub-1",
    contentId: content.id,
    campaignId: content.campaignId,
    platform: "instagram",
    provider: "meta",
    status: "published",
    idempotencyKey: `pub:${content.id}:instagram`,
    externalId: "ext-1",
    url: null,
    attemptCount: 1,
    scheduledFor: null,
    publishedAt,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastError: null,
  };
  const events = calendarEventsFromPublications(
    [publication],
    new Map([[content.id, content]]),
  );
  const event = events[0];
  assert.ok(event);
  assert.equal(calendarDayKeyForEvent(event, "America/New_York"), "2026-09-28");
  assert.equal(
    calendarDayKeyInMarketingTimezone(publishedAt, "America/New_York"),
    "2026-09-28",
  );
});

test("scheduled publication uses scheduledFor placement", () => {
  const content = sampleContent({ status: "scheduled" });
  const scheduledFor = marketingDatetimeLocalToIso("2026-10-08T09:00", "America/New_York");
  const publication: MarketingPublication = {
    id: "pub-s",
    contentId: content.id,
    campaignId: content.campaignId,
    platform: "instagram",
    provider: "meta",
    status: "scheduled",
    idempotencyKey: `pub:${content.id}:instagram:recycle:pub-s`,
    externalId: null,
    url: null,
    attemptCount: 0,
    scheduledFor,
    publishedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastError: null,
  };
  const events = calendarEventsFromPublications(
    [publication],
    new Map([[content.id, content]]),
  );
  assert.equal(events[0]?.eventKind, "scheduled");
  assert.equal(events[0]?.isRecycle, true);
  assert.equal(events[0]?.placementAt, scheduledFor);
});

test("published and scheduled publications coexist for same content", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedAsset(store);
  const content = sampleContent({ status: "approved" });
  await store.createContent(content);
  await approveContent(store, content.id, "owner");
  const original = await scheduleApproved(store, content.id, {
    scheduledFor: new Date(Date.now() - 86400000).toISOString(),
  });
  await publishPublication(store, original);
  const recycleTime = marketingDatetimeLocalToIso("2026-10-15T10:00", "America/New_York");
  await recyclePublished(store, content.id, { scheduledFor: recycleTime });
  const events = await listMarketingCalendarEvents(store);
  const forContent = events.filter((e) => e.contentId === content.id);
  assert.equal(forContent.length, 2);
  assert.equal(forContent.some((e) => e.eventKind === "published"), true);
  assert.equal(forContent.some((e) => e.eventKind === "scheduled" && e.isRecycle), true);
});

test("recycle idempotency marker detection", () => {
  assert.equal(isRecyclePublicationIdempotencyKey("pub:c:instagram:recycle:abc"), true);
  assert.equal(isRecyclePublicationIdempotencyKey("pub:c:instagram"), false);
});

test("original published publication unchanged after recycle", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedAsset(store);
  const content = sampleContent({ status: "approved" });
  await store.createContent(content);
  await approveContent(store, content.id, "owner");
  const original = await publishPublication(
    store,
    await scheduleApproved(store, content.id, {
      scheduledFor: new Date(Date.now() - 86400000).toISOString(),
    }),
  );
  await recyclePublished(store, content.id, {
    scheduledFor: marketingDatetimeLocalToIso("2026-10-08T12:00", "America/New_York"),
  });
  const after = await store.getPublication(original.id);
  assert.equal(after?.status, "published");
  assert.equal(after?.publishedAt, original.publishedAt);
});

test("two recycle publications create two independent calendar events", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedAsset(store);
  const content = sampleContent({ status: "approved" });
  await store.createContent(content);
  await approveContent(store, content.id, "owner");
  await publishPublication(
    store,
    await scheduleApproved(store, content.id, {
      scheduledFor: new Date(Date.now() - 86400000).toISOString(),
    }),
  );
  const a = marketingDatetimeLocalToIso("2026-10-08T09:00", "America/New_York");
  const b = marketingDatetimeLocalToIso("2026-10-15T15:00", "America/New_York");
  const recycleA = await recyclePublished(store, content.id, { scheduledFor: a });
  const recycleB = await recyclePublished(store, content.id, { scheduledFor: b });
  assert.notEqual(recycleA.id, recycleB.id);
  assert.equal(recycleA.idempotencyKey, recycleIdempotencyKey(content, recycleA.id));

  const events = await listMarketingCalendarEvents(store);
  const recycles = events.filter((e) => e.isRecycle && e.eventKind === "scheduled");
  assert.equal(recycles.length, 2);
  assert.deepEqual(
    recycles.map((e) => e.publicationId).sort(),
    [recycleA.id, recycleB.id].sort(),
  );
});

test("listMarketingCalendarEvents returns published and scheduled", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedAsset(store);
  const content = sampleContent({ status: "approved" });
  await store.createContent(content);
  await approveContent(store, content.id, "owner");
  await publishPublication(
    store,
    await scheduleApproved(store, content.id, {
      scheduledFor: new Date(Date.now() - 86400000).toISOString(),
    }),
  );
  await recyclePublished(store, content.id, {
    scheduledFor: marketingDatetimeLocalToIso("2026-11-01T12:00", "America/New_York"),
  });
  const events = await listMarketingCalendarEvents(store);
  assert.ok(events.some((e) => e.eventKind === "published"));
  assert.ok(events.some((e) => e.eventKind === "scheduled"));
});

test("calendar API route module still requires marketing admin", () => {
  const source = readFileSync(
    new URL("../../app/api/admin/marketing/calendar/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireMarketingAdmin/);
});

test("email published event is not recyclable on calendar", () => {
  const content = sampleContent({ platform: "email", format: "email" });
  const publication: MarketingPublication = {
    id: "pub-email",
    contentId: content.id,
    campaignId: content.campaignId,
    platform: "email",
    provider: "resend",
    status: "published",
    idempotencyKey: `pub:${content.id}:email`,
    externalId: "x",
    url: null,
    attemptCount: 1,
    scheduledFor: null,
    publishedAt: "2026-09-01T12:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastError: null,
  };
  const events = calendarEventsFromPublications(
    [publication],
    new Map([[content.id, content]]),
  );
  assert.equal(events[0]?.canRecycle, false);
});
