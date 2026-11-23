import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import { buildBufferCreatePostVariables } from "./buffer/buffer-tiktok-post";
import { BufferTikTokPublisher } from "./buffer-tiktok-publisher";
import { resolveTikTokPublishMedia, validatePublicHttpsMediaUrl } from "./buffer-tiktok-media";
import { runPublishPreflight } from "./publish-preflight";
import { isMp4VideoBuffer, tiktokSmartUploadFormat } from "./smart-upload-tiktok";
import type { MarketingContent, MarketingPublication } from "./types";

const originalEnv = { ...process.env };
const VERIFIED_CHANNEL_ID = "6ae9565de29c69a17143fd5d";
const PUBLIC_IMAGE = "https://twilight-feather.com/marketing-uploads/test-dry-run-image.jpg";
const PUBLIC_VIDEO = "https://twilight-feather.com/marketing-uploads/test-dry-run-video.mp4";

afterEach(() => {
  process.env = { ...originalEnv };
});

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "dry-run-content",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "tiktok",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Dry run title",
    body: "Caption for dry run",
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
    bookId: null,
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function samplePublication(content: MarketingContent): MarketingPublication {
  return {
    id: "dry-run-pub",
    contentId: content.id,
    campaignId: content.campaignId,
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "scheduled",
    idempotencyKey: `pub:${content.id}:tiktok`,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("image dry run: preflight, payload, customScheduled — no Buffer mutation", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.MARKETING_BUFFER_TIKTOK_ENABLED = "true";
  process.env.BUFFER_TIKTOK_CHANNEL_ID = VERIFIED_CHANNEL_ID;
  delete process.env.MARKETING_BUFFER_TIKTOK_LIVE;

  let mutationObserved = false;
  const publisher = new BufferTikTokPublisher({
    graphql: {
      accessToken: "dry-run-token",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(body.query).includes("mutation")) mutationObserved = true;
        return new Response(JSON.stringify({ data: null }), { status: 500 });
      },
    },
  });

  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "dry-image",
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
    url: PUBLIC_IMAGE,
    altText: null,
    isDemo: true,
  });
  const content = sampleContent({ format: "post" });
  await store.createContent(content);

  const resolved = resolveTikTokPublishMedia(content, [
    {
      id: "asset-1",
      name: "dry-image",
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
      url: PUBLIC_IMAGE,
      altText: null,
      isDemo: true,
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.media.kind, "image");
  assert.equal(validatePublicHttpsMediaUrl(resolved.media.publicUrl, "image"), null);

  process.env.MARKETING_MOCK_MODE = "true";
  const preflight = await runPublishPreflight(store, content);
  assert.equal(preflight.ok, true);
  assert.equal(preflight.imageUrl, PUBLIC_IMAGE);
  process.env.MARKETING_MOCK_MODE = "false";

  const variables = buildBufferCreatePostVariables({
    channelId: VERIFIED_CHANNEL_ID,
    text: content.body,
    schedulingType: "automatic",
    mode: "customScheduled",
    dueAt: samplePublication(content).scheduledFor!,
    media: resolved.media,
    photoTitle: content.title,
  });
  assert.deepEqual(variables.input.assets, [{ image: { url: PUBLIC_IMAGE } }]);
  assert.equal(variables.input.mode, "customScheduled");
  assert.ok(variables.input.dueAt);

  const result = await publisher.publish({
    content,
    publication: samplePublication(content),
    imageUrl: PUBLIC_IMAGE,
    hooks: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "buffer_tiktok_live_blocked");
  assert.equal(mutationObserved, false);
});

test("video dry run: MP4 format, payload, rejects carousel — no Buffer mutation", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.MARKETING_BUFFER_TIKTOK_ENABLED = "true";
  process.env.BUFFER_TIKTOK_CHANNEL_ID = VERIFIED_CHANNEL_ID;
  delete process.env.MARKETING_BUFFER_TIKTOK_LIVE;

  let mutationObserved = false;
  const publisher = new BufferTikTokPublisher({
    graphql: {
      accessToken: "dry-run-token",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(body.query).includes("mutation")) mutationObserved = true;
        return new Response(JSON.stringify({ data: null }), { status: 500 });
      },
    },
  });

  const mp4 = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
  assert.equal(isMp4VideoBuffer(mp4), true);
  assert.equal(tiktokSmartUploadFormat("video"), "reel_script");

  const content = sampleContent({ format: "reel_script", assetIds: ["asset-v"] });
  const resolved = resolveTikTokPublishMedia(content, [
    {
      id: "asset-v",
      name: "dry-video",
      type: "video",
      source: "upload",
      bookId: null,
      characterId: null,
      campaignId: null,
      approved: true,
      usageRestrictions: null,
      aspectRatio: null,
      mimeType: "video/mp4",
      tags: [],
      url: PUBLIC_VIDEO,
      altText: null,
      isDemo: true,
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.media.kind, "video");
  assert.equal(validatePublicHttpsMediaUrl(resolved.media.publicUrl, "video"), null);

  const carousel = resolveTikTokPublishMedia(sampleContent({ format: "carousel" }), []);
  assert.equal(carousel.ok, false);

  const variables = buildBufferCreatePostVariables({
    channelId: VERIFIED_CHANNEL_ID,
    text: content.body,
    schedulingType: "automatic",
    mode: "shareNow",
    media: resolved.media,
  });
  assert.deepEqual(variables.input.assets, [{ video: { url: PUBLIC_VIDEO } }]);

  const result = await publisher.publish({
    content,
    publication: { ...samplePublication(content), scheduledFor: null },
    videoUrl: PUBLIC_VIDEO,
    hooks: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "buffer_tiktok_live_blocked");
  assert.equal(mutationObserved, false);
});