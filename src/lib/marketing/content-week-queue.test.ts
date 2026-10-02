import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectContent } from "./approval";
import { marketingAuthError } from "./auth-guard";
import { executeMarketingContentPostAction } from "./content-post-action";
import {
  permanentlyDeleteRejectedContent,
  restoreRejectedContent,
} from "./content-lifecycle";
import {
  isPermanentDeleteConfirmed,
  PERMANENT_DELETE_CONFIRMATION,
  WEEK_WORKING_QUEUE_EXCLUDE_STATUSES,
} from "./content-week-queue";
import { MANUAL_UPLOAD_SOURCE } from "./content-metadata";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent } from "./types";

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "content-1",
    campaignId: "camp-1",
    weeklyPlanId: "plan-1",
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "Test post",
    body: "Caption text",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: "book-one",
    metadata: { source: MANUAL_UPLOAD_SOURCE },
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("week working queue excludes rejected content server-side", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ id: "active", status: "needs_review" }));
  await store.createContent(sampleContent({ id: "rejected", status: "rejected" }));
  const working = await store.listContent({
    weeklyPlanId: "plan-1",
    excludeStatuses: WEEK_WORKING_QUEUE_EXCLUDE_STATUSES,
  });
  assert.equal(working.length, 1);
  assert.equal(working[0]?.id, "active");
  const rejected = await store.listContent({
    weeklyPlanId: "plan-1",
    status: "rejected",
  });
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.id, "rejected");
});

test("restore changes rejected to needs_review without publication", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ status: "rejected" }));
  const restored = await restoreRejectedContent(store, "content-1", "owner");
  assert.equal(restored.status, "needs_review");
  assert.equal((await store.listPublications()).length, 0);
  const updated = await store.getContent("content-1");
  assert.equal(updated?.status, "needs_review");
});

test("restore API action does not approve or schedule", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "img",
    type: "upload",
    source: MANUAL_UPLOAD_SOURCE,
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
    url: "https://cdn.example.test/a.png",
    altText: "x",
    isDemo: false,
  });
  await store.createContent(sampleContent({ status: "rejected" }));
  const response = await executeMarketingContentPostAction(store, {
    action: "restore",
    contentId: "content-1",
    actor: "owner",
  });
  assert.equal(response.status, 200);
  const content = await store.getContent("content-1");
  assert.equal(content?.status, "needs_review");
  assert.equal((await store.listPublications()).length, 0);
});

test("permanent delete removes rejected content when safe", async () => {
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "img",
    type: "upload",
    source: MANUAL_UPLOAD_SOURCE,
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
    url: "/marketing-uploads/local-only.png",
    altText: "x",
    isDemo: false,
  });
  await store.createContent(sampleContent({ status: "rejected" }));
  const result = await permanentlyDeleteRejectedContent(store, "content-1", {
    confirmPermanentDelete: PERMANENT_DELETE_CONFIRMATION,
    actor: "owner",
  });
  assert.equal(result.deleted, true);
  assert.equal(await store.getContent("content-1"), null);
  assert.equal(await store.getAsset("asset-1"), null);
});

test("published content cannot be permanently deleted", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ status: "published" }));
  await assert.rejects(
    () =>
      permanentlyDeleteRejectedContent(store, "content-1", {
        confirmPermanentDelete: PERMANENT_DELETE_CONFIRMATION,
        actor: "owner",
      }),
    /Only rejected content can be permanently deleted/,
  );
});

test("scheduled publication blocks permanent delete", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ status: "rejected" }));
  await store.createPublication({
    id: "pub-1",
    contentId: "content-1",
    campaignId: "camp-1",
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: "idem-1",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
  });
  await assert.rejects(
    () =>
      permanentlyDeleteRejectedContent(store, "content-1", {
        confirmPermanentDelete: PERMANENT_DELETE_CONFIRMATION,
        actor: "owner",
      }),
    /publication is scheduled/,
  );
});

test("shared manual-upload asset is not deleted while still referenced", async () => {
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-shared",
    name: "img",
    type: "upload",
    source: MANUAL_UPLOAD_SOURCE,
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
    url: "/marketing-uploads/shared.png",
    altText: "x",
    isDemo: false,
  });
  await store.createContent(
    sampleContent({ id: "keep", status: "needs_review", assetIds: ["asset-shared"] }),
  );
  await store.createContent(
    sampleContent({ id: "gone", status: "rejected", assetIds: ["asset-shared"] }),
  );
  await permanentlyDeleteRejectedContent(store, "gone", {
    confirmPermanentDelete: PERMANENT_DELETE_CONFIRMATION,
    actor: "owner",
  });
  assert.equal(await store.getContent("gone"), null);
  assert.ok(await store.getAsset("asset-shared"), "shared asset must remain");
});

test("permanent delete requires explicit confirmation token", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ status: "rejected" }));
  await assert.rejects(
    () =>
      permanentlyDeleteRejectedContent(store, "content-1", {
        confirmPermanentDelete: "yes",
        actor: "owner",
      }),
    /explicit confirmation/,
  );
});

test("delete_permanent API returns 400 without confirmation", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ status: "rejected" }));
  const response = await executeMarketingContentPostAction(store, {
    action: "delete_permanent",
    contentId: "content-1",
    confirmPermanentDelete: undefined,
    actor: "owner",
  });
  assert.equal(response.status, 400);
});

test("unauthenticated admin guard blocks marketing actions", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
});

test("UI confirmation helper matches server token", () => {
  assert.equal(isPermanentDeleteConfirmed(PERMANENT_DELETE_CONFIRMATION), true);
  assert.equal(isPermanentDeleteConfirmed("DELETE"), false);
});

test("reject then restore returns item to working queue filter", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent(sampleContent({ status: "needs_review" }));
  await rejectContent(store, "content-1", "owner", "Not this week.");
  let working = await store.listContent({
    weeklyPlanId: "plan-1",
    excludeStatuses: WEEK_WORKING_QUEUE_EXCLUDE_STATUSES,
  });
  assert.equal(working.length, 0);
  await restoreRejectedContent(store, "content-1", "owner");
  working = await store.listContent({
    weeklyPlanId: "plan-1",
    excludeStatuses: WEEK_WORKING_QUEUE_EXCLUDE_STATUSES,
  });
  assert.equal(working.length, 1);
});
