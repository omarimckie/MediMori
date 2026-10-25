import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContentListPreviewById } from "./content-list-preview";
import { buildMarketingWebsiteDestinationReview } from "./marketing-website-destination";
import { MemoryMarketingStore } from "./memory-store";
import { buildWeeklyItemReview } from "./weekly-review";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

function createWriteGuardStore(inner: MarketingStore): MarketingStore {
  const guard = (method: string) => {
    throw new Error(`Unexpected store write during read-only review: ${method}`);
  };
  return {
    ...inner,
    createContent: () => guard("createContent"),
    updateContent: () => guard("updateContent"),
    deleteContent: () => guard("deleteContent"),
    createAsset: () => guard("createAsset"),
    updateAsset: () => guard("updateAsset"),
    createPublication: () => guard("createPublication"),
    updatePublication: () => guard("updatePublication"),
    recordClick: () => guard("recordClick"),
    recordEvent: () => guard("recordEvent"),
  };
}

function sample(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "c-readonly",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
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
    trackingToken: "abcd1234abcd1234",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("buildMarketingWebsiteDestinationReview does not use the store", () => {
  const review = buildMarketingWebsiteDestinationReview(sample({ platform: "pinterest", format: "pin" }));
  assert.ok(review.destinationPath);
  assert.equal(review.platformLinkBehavior, "clickable_destination");
});

test("weekly and queue preview enrichment paths are store read-only", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const inner = new MemoryMarketingStore();
  const content = sample();
  await inner.createContent(content);
  const store = createWriteGuardStore(inner);

  const weekly = await buildWeeklyItemReview(store, content);
  assert.ok(weekly.websiteDestination.readiness);

  const previews = await buildContentListPreviewById(store, [content]);
  assert.ok(previews[content.id]?.websiteDestination.trackingLink);
});
