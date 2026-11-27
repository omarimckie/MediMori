import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import { publishPublication } from "./approval";
import { BufferTikTokPublisher } from "./buffer-tiktok-publisher";
import { publicationRetryBlockedReason } from "./publication-ambiguity/guards";
import { shouldStampCronAutoRetryForPlatform } from "./publication-cron-retry";
import { getSocialPublisher } from "./publishers";
import type { MarketingContent, MarketingPublication } from "./types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test("getSocialPublisher routes only tiktok to buffer", () => {
  process.env.MARKETING_MOCK_MODE = "false";
  assert.equal(getSocialPublisher("instagram").id, "instagram");
  assert.equal(getSocialPublisher("facebook").id, "facebook_page");
  assert.equal(getSocialPublisher("pinterest").id, "pinterest");
  assert.equal(getSocialPublisher("tiktok").id, "buffer_tiktok");
});

test("Buffer live success defers published state via publisher flag", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.MARKETING_BUFFER_TIKTOK_ENABLED = "true";
  process.env.MARKETING_BUFFER_TIKTOK_LIVE = "true";
  process.env.MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE = "automated";
  process.env.BUFFER_TIKTOK_CHANNEL_ID = "ch";
  process.env.BUFFER_ACCESS_TOKEN = "test-token";
  const publisher = new BufferTikTokPublisher({
    graphql: {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: {
              createPost: {
                __typename: "PostActionSuccess",
                post: { id: "buf-1", dueAt: null, status: "scheduled" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  });
  const content: MarketingContent = {
    id: "c",
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const publication: MarketingPublication = {
    id: "p",
    contentId: "c",
    campaignId: "camp",
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "processing",
    idempotencyKey: "pub:c:tiktok",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: null,
    publishedAt: null,
    claimToken: "claim",
    processingStartedAt: new Date().toISOString(),
    providerCreationId: null,
    ambiguityState: "none",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const result = await publisher.publish({
    content,
    publication,
    imageUrl: "https://cdn.example/a.jpg",
  });
  assert.equal(result.ok, true);
  assert.equal(result.deferFinalPublishedState, true);
});

test("publishPublication does not republish when externalId exists", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content: MarketingContent = {
    id: "c",
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
    assetIds: ["a1"],
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
  };
  await store.createContent(content);
  await store.createAsset({
    id: "a1",
    name: "img",
    type: "upload",
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
  const publication = await store.createPublication({
    id: "pub",
    contentId: "c",
    campaignId: "camp",
    platform: "tiktok",
    provider: "mock:buffer_tiktok",
    status: "processing",
    idempotencyKey: "pub:c:tiktok",
    externalId: "buf-existing",
    url: null,
    attemptCount: 1,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    claimToken: "tok",
    processingStartedAt: new Date().toISOString(),
    providerCreationId: null,
    ambiguityState: "none",
  });
  const out = await publishPublication(store, publication);
  assert.equal(out.externalId, "buf-existing");
  assert.equal(out.status, "processing");
});

test("admin retry blocked when Buffer externalId present", () => {
  const reason = publicationRetryBlockedReason({
    id: "p",
    contentId: "c",
    campaignId: null,
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "failed",
    idempotencyKey: "k",
    externalId: "buf-1",
    url: null,
    attemptCount: 2,
    lastError: "x",
    scheduledFor: null,
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.match(reason ?? "", /already submitted to Buffer/i);
});

test("cron auto-retry stamp never applies to tiktok", () => {
  assert.equal(shouldStampCronAutoRetryForPlatform("tiktok", true), false);
});