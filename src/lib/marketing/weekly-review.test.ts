import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import { buildWeeklyItemReview, weeklyChannelLabel } from "./weekly-review";
import type { MarketingContent } from "./types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "content-1",
    campaignId: "camp",
    weeklyPlanId: "plan",
    platform: "pinterest",
    format: "pin",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "Pin title",
    body: "Pin body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("weeklyChannelLabel for Pinterest pin", () => {
  const content = sampleContent();
  assert.equal(weeklyChannelLabel(content), "Pinterest · Pin · Vertical");
});

test("visual item review uses publisher image URL and dimensions", async () => {
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
  const content = sampleContent();
  await store.createContent(content);

  const review = await buildWeeklyItemReview(store, content);
  assert.equal(review.showVisualPreview, true);
  assert.equal(review.previewUrl, "https://twilight-feather.com/covers/sickle-cell.png");
  assert.equal(review.dimensionsLabel, "1009 × 1024 · 1009:1024");
  assert.match(review.visualSuitabilityWarning ?? "", /Visual is not suitable for Pinterest · Pin · Vertical/);
  assert.match(review.visualSuitabilityWarning ?? "", /outside pinterest acceptable range/);
});

test("email item review does not request visual preview", async () => {
  const store = new MemoryMarketingStore();
  const content = sampleContent({ platform: "email", format: "email", assetIds: [] });
  await store.createContent(content);
  const review = await buildWeeklyItemReview(store, content);
  assert.equal(review.showVisualPreview, false);
  assert.equal(review.previewUrl, null);
  assert.equal(review.dimensionsLabel, null);
  assert.equal(review.visualSuitabilityWarning, null);
});

test("vertical Pinterest asset passes suitability review", async () => {
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
  const content = sampleContent();
  await store.createContent(content);
  const review = await buildWeeklyItemReview(store, content);
  assert.equal(review.previewUrl, "https://cdn.example.test/pin.png");
  assert.equal(review.dimensionsLabel, "1000 × 1500 · 1000:1500");
  assert.equal(review.visualSuitabilityWarning, null);
});
