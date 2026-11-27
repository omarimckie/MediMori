import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import { approveContent, publishPublication, scheduleApproved } from "./approval";
import { buildBufferCreatePostVariables } from "./buffer/buffer-tiktok-post";
import { BufferGraphqlError } from "./buffer/buffer-graphql-client";
import { BufferTikTokPublisher } from "./buffer-tiktok-publisher";
import {
  resolveTikTokPublishMedia,
  tiktokUnsupportedFormatMessage,
  validatePublicHttpsMediaUrl,
} from "./buffer-tiktok-media";
import { getSocialPublisher } from "./publishers";
import { runPublishPreflight } from "./publish-preflight";
import type { MarketingContent, MarketingPublication } from "./types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function sampleTikTokContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "tt-content",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "tiktok",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "TikTok title",
    body: "Caption body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-img"],
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

function samplePublication(content: MarketingContent): MarketingPublication {
  return {
    id: "pub-tt",
    contentId: content.id,
    campaignId: content.campaignId,
    platform: "tiktok",
    provider: "mock:buffer_tiktok",
    status: "scheduled",
    idempotencyKey: `pub:${content.id}:tiktok`,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("tiktok carousel is rejected in preflight and media resolver", () => {
  const message = tiktokUnsupportedFormatMessage("carousel");
  assert.match(message, /carousel/i);
  const resolved = resolveTikTokPublishMedia(
    sampleTikTokContent({ format: "carousel" }),
    [],
  );
  assert.equal(resolved.ok, false);
});

test("buildBufferCreatePostVariables maps image and video assets", () => {
  const imageVars = buildBufferCreatePostVariables({
    channelId: "ch-1",
    text: "hi",
    schedulingType: "automatic",
    mode: "shareNow",
    media: { kind: "image", publicUrl: "https://cdn.example/a.jpg" },
    photoTitle: "Title",
  });
  assert.deepEqual(imageVars.input.assets, [{ image: { url: "https://cdn.example/a.jpg" } }]);

  const videoVars = buildBufferCreatePostVariables({
    channelId: "ch-1",
    text: "hi",
    schedulingType: "automatic",
    mode: "customScheduled",
    dueAt: "2026-01-01T12:00:00.000Z",
    media: { kind: "video", publicUrl: "https://cdn.example/v.mp4" },
  });
  assert.deepEqual(videoVars.input.assets, [{ video: { url: "https://cdn.example/v.mp4" } }]);
});

test("getSocialPublisher tiktok returns BufferTikTokPublisher even in mock mode", () => {
  process.env.MARKETING_MOCK_MODE = "true";
  assert.equal(getSocialPublisher("tiktok").id, "buffer_tiktok");
});

test("BufferTikTokPublisher mock mode succeeds without live gate", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const publisher = new BufferTikTokPublisher();
  const content = sampleTikTokContent();
  const result = await publisher.publish({
    content,
    publication: samplePublication(content),
    imageUrl: "https://cdn.example/a.jpg",
  });
  assert.equal(result.ok, true);
  assert.match(result.externalId ?? "", /^mock_buffer_/);
  assert.notEqual(result.deferFinalPublishedState, true);
});

test("BufferTikTokPublisher blocks live mutations without MARKETING_BUFFER_TIKTOK_LIVE", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.MARKETING_BUFFER_TIKTOK_ENABLED = "true";
  process.env.MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE = "automated";
  process.env.BUFFER_TIKTOK_CHANNEL_ID = "ch-tiktok";
  const publisher = new BufferTikTokPublisher();
  const content = sampleTikTokContent();
  const result = await publisher.publish({
    content,
    publication: samplePublication(content),
    imageUrl: "https://cdn.example/a.jpg",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "buffer_tiktok_live_blocked");
});

test("buffer graphql client surfaces retryable rate limits through BufferGraphqlError", async () => {
  const err = new BufferGraphqlError("buffer_rate_limited:60000", { retryable: true, status: 429 });
  assert.equal(err.retryable, true);
  assert.equal(err.status, 429);
});

test("mock mode tiktok schedule and publish flow", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-img",
    name: "img",
    type: "image",
    source: "upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: null,
    mimeType: "image/jpeg",
    tags: [],
    url: "https://cdn.example/a.jpg",
    altText: null,
    isDemo: false,
  });
  const content = sampleTikTokContent();
  await store.createContent(content);
  await approveContent(store, content.id, "tester");
  const preflight = await runPublishPreflight(store, { ...content, status: "approved" });
  assert.equal(preflight.ok, true);
  const publication = await scheduleApproved(store, content.id);
  assert.equal(publication.platform, "tiktok");
  const published = await publishPublication(store, publication);
  assert.equal(published.status, "published");
  assert.ok(published.externalId);
});

test("validatePublicHttpsMediaUrl accepts https video shape", () => {
  assert.equal(validatePublicHttpsMediaUrl("https://cdn.example/v.mp4", "video"), null);
});