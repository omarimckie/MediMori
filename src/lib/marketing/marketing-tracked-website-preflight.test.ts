import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleApproved } from "./approval";
import { MemoryMarketingStore } from "./memory-store";
import { socialContentGrandfatheredWithoutTrackedLink } from "./marketing-website-destination";
import { runPublishPreflight } from "./publish-preflight";
import type { MarketingContent } from "./types";

function socialContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "c-track",
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

test("new approved social content without tracking token fails preflight", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = socialContent();
  await store.createContent(content);
  const preflight = await runPublishPreflight(store, content);
  assert.equal(preflight.ok, false);
  if (preflight.ok) throw new Error("expected failure");
  assert.equal(preflight.code, "tracking_link_required");
  assert.match(preflight.message, /tracking token is required/i);
});

test("scheduleApproved rejects new approved content missing tracking token", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = socialContent();
  await store.createContent(content);
  await assert.rejects(
    () => scheduleApproved(store, content.id, { scheduledFor: new Date().toISOString() }),
    /tracking token is required/i,
  );
});

test("legacy scheduled social content without token skips tracking gate", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = socialContent({
    status: "scheduled",
    trackingToken: null,
    scheduledFor: new Date().toISOString(),
  });
  assert.equal(socialContentGrandfatheredWithoutTrackedLink(content), true);
  await store.createContent(content);
  const preflight = await runPublishPreflight(store, content);
  if (!preflight.ok) {
    assert.notEqual(preflight.code, "tracking_link_required");
  }
});
