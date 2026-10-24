import assert from "node:assert/strict";
import { test } from "node:test";
import { composeSocialPublishCaption } from "./marketing-social-website-link";
import type { MarketingContent } from "./types";

test("composeSocialPublishCaption appends tracked link without duplicating", () => {
  const content: MarketingContent = {
    id: "c1",
    campaignId: null,
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: null,
    body: "Hello world",
    cta: "Read more",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok123",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const caption = composeSocialPublishCaption(content);
  assert.match(caption, /Hello world/);
  assert.match(caption, /Read more/);
  assert.match(caption, /\/api\/m\/tok123/);
  const again = composeSocialPublishCaption({ ...content, body: caption });
  assert.equal(again.split("/api/m/tok123").length - 1, 1);
});
