import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { publishPublication } from "./approval";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent, MarketingPublication } from "./types";

const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

test("publishPublication leaves non-allowlisted rows unchanged in controlled live mode", async () => {
  const allowedId = crypto.randomUUID();
  const blockedId = crypto.randomUUID();
  Object.assign(process.env, {
    MARKETING_MOCK_MODE: "false",
    MARKETING_BUFFER_TIKTOK_ENABLED: "true",
    MARKETING_BUFFER_TIKTOK_LIVE: "true",
    MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "controlled",
    MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID: allowedId,
    BUFFER_TIKTOK_CHANNEL_ID: "ch",
  });

  const store = new MemoryMarketingStore();
  const contentId = crypto.randomUUID();
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
    url: "https://cdn.example.test/a.png",
    altText: "x",
    isDemo: true,
  });
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "tiktok",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: "2020-01-01T12:00:00.000Z",
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  });

  const publication = await store.createPublication({
    id: blockedId,
    contentId,
    campaignId: null,
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "scheduled",
    idempotencyKey: `pub:${contentId}:tiktok`,
    externalId: null,
    url: null,
    attemptCount: 2,
    lastError: null,
    scheduledFor: "2020-01-01T12:00:00.000Z",
    publishedAt: null,
    ambiguityState: "none",
  } satisfies Omit<MarketingPublication, "createdAt" | "updatedAt">);

  const before = { ...publication };
  const after = await publishPublication(store, publication);
  assert.equal(after.status, before.status);
  assert.equal(after.attemptCount, before.attemptCount);
  assert.equal(after.externalId, before.externalId);
});