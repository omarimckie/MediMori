import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { BufferGraphqlError } from "./buffer/buffer-graphql-client";
import { reconcileBufferTikTokPublications } from "./buffer-tiktok-reconcile";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingPublication } from "./types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function liveEnv(): Record<string, string> {
  return {
    MARKETING_MOCK_MODE: "false",
    MARKETING_BUFFER_TIKTOK_ENABLED: "true",
    MARKETING_BUFFER_TIKTOK_LIVE: "true",
  };
}

function tiktokPub(
  overrides: Partial<MarketingPublication> = {},
): MarketingPublication {
  return {
    id: "pub-1",
    contentId: "c-1",
    campaignId: "camp",
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "processing",
    idempotencyKey: "pub:c-1:tiktok",
    externalId: "buffer-post-1",
    url: null,
    attemptCount: 1,
    lastError: null,
    scheduledFor: null,
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("reconcile is no-op when feature disabled", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(tiktokPub());
  const stats = await reconcileBufferTikTokPublications(store);
  assert.equal(stats.scanned, 0);
});

test("reconcile maps sent status to published", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent({
    id: "c-1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "tiktok",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "t",
    body: "b",
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
    bookId: null,
    metadata: {},
    isDemo: false,
  });
  await store.createPublication(tiktokPub());
  const stats = await reconcileBufferTikTokPublications(store, {
    env: liveEnv(),
    fetchPost: async () => ({
      id: "buffer-post-1",
      status: "sent",
      dueAt: null,
      channelId: "ch",
    }),
  });
  assert.equal(stats.published, 1);
  const pub = await store.getPublication("pub-1");
  assert.equal(pub?.status, "published");
  const content = await store.getContent("c-1");
  assert.equal(content?.status, "published");
});

test("reconcile maps failed remote status", async () => {
  const store = new MemoryMarketingStore();
  await store.createContent({
    id: "c-1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "tiktok",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "t",
    body: "b",
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
    bookId: null,
    metadata: {},
    isDemo: false,
  });
  await store.createPublication(tiktokPub());
  const stats = await reconcileBufferTikTokPublications(store, {
    env: liveEnv(),
    fetchPost: async () => ({
      id: "buffer-post-1",
      status: "failed",
      dueAt: null,
      channelId: "ch",
    }),
  });
  assert.equal(stats.failed, 1);
  assert.equal((await store.getPublication("pub-1"))?.status, "failed");
});

test("reconcile leaves scheduled unchanged for scheduled remote", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(tiktokPub({ status: "scheduled", scheduledFor: new Date().toISOString() }));
  const stats = await reconcileBufferTikTokPublications(store, {
    env: liveEnv(),
    fetchPost: async () => ({
      id: "buffer-post-1",
      status: "scheduled",
      dueAt: new Date().toISOString(),
      channelId: "ch",
    }),
  });
  assert.equal(stats.unchanged, 1);
  assert.equal((await store.getPublication("pub-1"))?.status, "scheduled");
});

test("reconcile tolerates missing remote post", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(tiktokPub());
  const stats = await reconcileBufferTikTokPublications(store, {
    env: liveEnv(),
    fetchPost: async () => null,
  });
  assert.equal(stats.unchanged, 1);
});

test("reconcile tolerates fetch timeout errors", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(tiktokPub());
  const stats = await reconcileBufferTikTokPublications(store, {
    env: liveEnv(),
    fetchPost: async () => {
      throw new BufferGraphqlError("buffer_rate_limited:60000", { retryable: true, status: 429 });
    },
  });
  assert.equal(stats.unchanged, 1);
});