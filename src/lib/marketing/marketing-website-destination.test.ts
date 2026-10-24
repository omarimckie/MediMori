import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMarketingWebsiteDestinationReview,
  isApprovedMarketingDestinationPath,
  resolveMarketingWebsiteDestinationPath,
  validateTrackedWebsiteDestinationForPublish,
} from "./marketing-website-destination";
import type { MarketingContent } from "./types";

function sample(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "c1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "facebook",
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
    trackingToken: "abc123",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("approved destination allowlist rejects external and unsafe paths", () => {
  assert.equal(isApprovedMarketingDestinationPath("/"), true);
  assert.equal(isApprovedMarketingDestinationPath("/books/book-one"), true);
  assert.equal(isApprovedMarketingDestinationPath("/books/unknown"), false);
  assert.equal(isApprovedMarketingDestinationPath("https://evil.test/phish"), false);
  assert.equal(isApprovedMarketingDestinationPath("/books/book-one?x=1"), false);
  assert.equal(isApprovedMarketingDestinationPath("/../books/book-one"), false);
});

test("resolveMarketingWebsiteDestinationPath uses book page for product categories", () => {
  assert.equal(
    resolveMarketingWebsiteDestinationPath(sample({ category: "educational" })),
    "/books/book-one",
  );
  assert.equal(
    resolveMarketingWebsiteDestinationPath(sample({ category: "brand_story" })),
    "/",
  );
  assert.equal(resolveMarketingWebsiteDestinationPath(sample({ bookId: null })), "/");
});

test("free resource content resolves to public resource path", () => {
  const path = resolveMarketingWebsiteDestinationPath(
    sample({
      platform: "website",
      format: "free_resource",
      bookId: null,
      metadata: { slug: "sickle-cell-coloring" },
    }),
  );
  assert.equal(path, "/resources/free/sickle-cell-coloring");
});

test("buildMarketingWebsiteDestinationReview includes platform guidance and tracking link", () => {
  const review = buildMarketingWebsiteDestinationReview(
    sample({ platform: "instagram" }),
    { hasImagePost: true },
  );
  assert.equal(review.destinationPath, "/books/book-one");
  assert.ok(review.trackingLink?.includes("/api/m/abc123"));
  assert.match(review.platformNavigationSummary, /not clickable/i);
  assert.ok(review.warnings.some((w) => /Instagram feed/i.test(w)));
});

test("validateTrackedWebsiteDestinationForPublish requires token and approved path", () => {
  const missing = validateTrackedWebsiteDestinationForPublish(sample({ trackingToken: null }));
  assert.equal(missing.ok, false);
  if (missing.ok) throw new Error("expected failure");
  assert.equal(missing.code, "tracking_token_missing");
  assert.match(missing.message, /tracking token/i);

  const ok = validateTrackedWebsiteDestinationForPublish(sample());
  assert.equal(ok.ok, true);
});

test("buildMarketingWebsiteDestinationReview exposes readiness diagnostics", () => {
  const blocked = buildMarketingWebsiteDestinationReview(
    sample({ trackingToken: null, status: "approved" }),
  );
  assert.equal(blocked.readiness, "blocked");
  assert.equal(blocked.publishBlocked, true);
  assert.ok(blocked.recoveryHints.length > 0);
});

test("platform link behavior distinguishes Facebook text feed link vs image caption", () => {
  const textPost = buildMarketingWebsiteDestinationReview(
    sample({ platform: "facebook", format: "post" }),
    { hasImagePost: false },
  );
  assert.equal(textPost.platformLinkBehavior, "feed_link_field");
  assert.match(textPost.platformNavigationSummary, /feed link/i);

  const imagePost = buildMarketingWebsiteDestinationReview(
    sample({ platform: "facebook", format: "post" }),
    { hasImagePost: true },
  );
  assert.equal(imagePost.platformLinkBehavior, "caption_text_only");
  assert.ok(imagePost.issues.some((i) => i.code === "facebook_image_caption_link"));
});

test("grandfathered published and scheduled rows are not publish-blocked in diagnostics", () => {
  for (const status of ["scheduled", "published"] as const) {
    const review = buildMarketingWebsiteDestinationReview(
      sample({ trackingToken: null, status, platform: "instagram" }),
      { hasImagePost: true },
    );
    assert.equal(review.grandfatheredWithoutTrackedLink, true);
    assert.equal(review.publishBlocked, false);
    assert.equal(review.readiness, "warning");
  }
});

test("invalid metadata override surfaces a warning", () => {
  const review = buildMarketingWebsiteDestinationReview(
    sample({
      metadata: { websiteDestinationPath: "https://phishing.example" },
    }),
  );
  assert.equal(review.destinationPath, "/books/book-one");
  assert.ok(review.warnings.some((w) => /rejected/i.test(w)));
});
