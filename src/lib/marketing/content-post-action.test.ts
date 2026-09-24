import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { approveContent } from "./approval";
import { executeMarketingContentPostAction } from "./content-post-action";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent } from "./types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function samplePinterestContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "pin-content",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "pinterest",
    format: "pin",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Gentle sickle cell story",
    body: "A kind conversation starter for families.",
    cta: "Visit the book page",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "abc123tracking",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("schedule API handler returns 400 with preflight error instead of 500", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.PINTEREST_CLIENT_ID = "client";
  process.env.PINTEREST_CLIENT_SECRET = "secret";
  process.env.PINTEREST_REFRESH_TOKEN = "pinr_refresh";
  process.env.PINTEREST_BOARD_ID = "1113655882796897267";
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";

  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "cover",
    type: "cover",
    source: "catalog",
    bookId: "book-one",
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1:1",
    imageWidth: null,
    imageHeight: null,
    mimeType: null,
    tags: [],
    url: "/covers/sickle-cell.png",
    altText: "cover",
    isDemo: false,
  });
  const content = samplePinterestContent();
  await store.createContent(content);
  await approveContent(store, content.id, "owner");

  const response = await executeMarketingContentPostAction(store, {
    action: "schedule",
    contentId: content.id,
    actor: "owner",
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(
    body.error ?? "",
    /invalid_aspect_ratio: Image aspect ratio 0\.985 \(1009:1024\) is outside pinterest acceptable range 0\.476–0\.667 \(width\/height\)\./,
  );
  assert.equal((await store.listPublications()).length, 0);
});

test("schedule API handler still schedules when preflight passes", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "pin",
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "2:3",
    imageWidth: 1000,
    imageHeight: 1500,
    mimeType: "image/png",
    tags: [],
    url: "https://cdn.example.test/pin.png",
    altText: "x",
    isDemo: false,
  });
  const content = samplePinterestContent();
  await store.createContent(content);
  await approveContent(store, content.id, "owner");

  const response = await executeMarketingContentPostAction(store, {
    action: "schedule",
    contentId: content.id,
    actor: "owner",
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { result?: { status?: string } };
  assert.equal(body.result?.status, "scheduled");
  const updated = await store.getContent(content.id);
  assert.equal(updated?.status, "scheduled");
});
