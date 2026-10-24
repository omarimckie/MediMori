import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWebsiteDestinationDiagnostics } from "./marketing-website-destination-diagnostics";
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
    trackingToken: "abcd1234abcd1234",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("diagnostics block new social content without tracking token", () => {
  const diagnostics = buildWebsiteDestinationDiagnostics({
    content: sample({ trackingToken: null, status: "approved" }),
    hasImagePost: true,
    destinationPath: "/books/book-one",
    destinationAllowlisted: true,
    trackingLink: null,
    overrideRejected: false,
    grandfatheredWithoutTrackedLink: false,
  });
  assert.equal(diagnostics.readiness, "blocked");
  assert.equal(diagnostics.publishBlocked, true);
  assert.ok(diagnostics.issues.some((i) => i.code === "tracking_token_missing"));
});

test("diagnostics warn for grandfathered scheduled rows without token", () => {
  const diagnostics = buildWebsiteDestinationDiagnostics({
    content: sample({ trackingToken: null, status: "scheduled" }),
    hasImagePost: true,
    destinationPath: "/books/book-one",
    destinationAllowlisted: true,
    trackingLink: null,
    overrideRejected: false,
    grandfatheredWithoutTrackedLink: true,
  });
  assert.equal(diagnostics.publishBlocked, false);
  assert.equal(diagnostics.readiness, "warning");
  assert.ok(diagnostics.issues.some((i) => i.code === "grandfathered_without_tracked_link"));
});

test("pinterest diagnostics mark clickable destination", () => {
  const diagnostics = buildWebsiteDestinationDiagnostics({
    content: sample({ platform: "pinterest", format: "pin" }),
    hasImagePost: true,
    destinationPath: "/books/book-one",
    destinationAllowlisted: true,
    trackingLink: "https://twilight-feather.com/api/m/abcd1234abcd1234",
    overrideRejected: false,
    grandfatheredWithoutTrackedLink: false,
  });
  assert.equal(diagnostics.platformLinkBehavior, "clickable_destination");
  assert.ok(diagnostics.issues.some((i) => i.code === "pinterest_clickable_pin_link"));
});
