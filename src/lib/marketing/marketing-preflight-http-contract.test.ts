import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleApproved } from "./approval";
import { contentActionFailureStatus } from "./content-post-action";
import { executeMarketingContentPostAction } from "./content-post-action";
import { MemoryMarketingStore } from "./memory-store";
import { SOCIAL_SCHEDULE_TEST_TRACKING_TOKEN } from "./marketing-social-tracking-test-token";
import { retryAdminPublication } from "./publication-retry";
import type { MarketingContent, MarketingPublication } from "./types";

/**
 * HTTP status contract (unchanged by Agent 2 reliability work):
 * - Content workflow actions (schedule, etc.) map preflight failures to **400** via contentActionFailureStatus.
 * - Admin publication retry maps preflight failures to **422** with a structured `preflight` body field.
 */

function socialContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "c-http-contract",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Title",
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
    trackingToken: null,
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("contentActionFailureStatus maps new preflight codes to 400", () => {
  assert.equal(contentActionFailureStatus("destination_path_invalid: bad path"), 400);
  assert.equal(contentActionFailureStatus("asset_not_ready: needs asset"), 400);
  assert.equal(contentActionFailureStatus("tracking_link_required: missing token"), 400);
});

test("schedule content action returns 400 (not 422) when tracking preflight fails", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = socialContent();
  await store.createContent(content);

  const response = await executeMarketingContentPostAction(store, {
    action: "schedule",
    contentId: content.id,
    scheduledFor: new Date().toISOString(),
    actor: "owner",
  });

  assert.equal(response.status, 400);
  assert.notEqual(response.status, 422);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /tracking token is required/i);
  assert.equal((await store.listPublications()).length, 0);
});

test("scheduleApproved surfaces tracking gate as thrown 400-class message", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = socialContent();
  await store.createContent(content);
  await assert.rejects(
    () => scheduleApproved(store, content.id, { scheduledFor: new Date().toISOString() }),
    /tracking token is required/i,
  );
});

test("admin publication retry returns 422 with preflight payload when tracking fails", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const contentId = "content-fb-retry-preflight";
  const publicationId = "pub-fb-retry-preflight";
  const content = socialContent({
    id: contentId,
    status: "failed",
    trackingToken: null,
  });
  await store.createContent(content);
  const publication: MarketingPublication = {
    id: publicationId,
    contentId,
    campaignId: "camp",
    platform: "facebook",
    provider: "facebook",
    status: "failed",
    idempotencyKey: "k",
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "publish_failed: prior",
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createPublication(publication);

  const before = await store.getPublication(publicationId);
  const result = await retryAdminPublication(store, publicationId);

  assert.equal(result.status, 422);
  assert.notEqual(result.status, 400);
  assert.equal(result.body.preflight?.code, "tracking_link_required");
  assert.match(result.body.error?.message ?? "", /Recovery:/);
  const after = await store.getPublication(publicationId);
  assert.equal(after?.attemptCount, before?.attemptCount);
});

test("admin publication retry returns 422 for asset_not_ready", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const contentId = "content-asset-not-ready";
  const publicationId = "pub-asset-not-ready";
  await store.createContent(
    socialContent({
      id: contentId,
      status: "scheduled",
      trackingToken: SOCIAL_SCHEDULE_TEST_TRACKING_TOKEN,
      needsNewAsset: true,
    }),
  );
  const publication: MarketingPublication = {
    id: publicationId,
    contentId,
    campaignId: "camp",
    platform: "facebook",
    provider: "facebook",
    status: "failed",
    idempotencyKey: "k2",
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "publish_failed: prior",
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createPublication(publication);

  const result = await retryAdminPublication(store, publicationId);
  assert.equal(result.status, 422);
  assert.equal(result.body.preflight?.code, "asset_not_ready");
});
