import assert from "node:assert/strict";
import { test } from "node:test";
import { filterUnscheduledApprovedContent } from "./calendar-unscheduled";
import type { MarketingContent, MarketingPublication } from "./types";

function content(overrides: Partial<MarketingContent>): MarketingContent {
  return {
    id: "c1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "T",
    body: "B",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("approved content appears in unscheduled when no active schedule", () => {
  const items = filterUnscheduledApprovedContent([content({})], []);
  assert.equal(items.length, 1);
});

test("needs_review and rejected do not appear", () => {
  const items = filterUnscheduledApprovedContent(
    [
      content({ id: "a", status: "needs_review" }),
      content({ id: "b", status: "rejected" }),
      content({ id: "c", status: "approved" }),
    ],
    [],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "c");
});

test("scheduled content with active scheduled publication is excluded", () => {
  const pubs: Pick<MarketingPublication, "contentId" | "platform" | "status">[] = [
    { contentId: "c1", platform: "instagram", status: "scheduled" },
  ];
  const items = filterUnscheduledApprovedContent([content({})], pubs);
  assert.equal(items.length, 0);
});

test("scheduling removes item from unscheduled list when publication is active", () => {
  const approved = [content({ id: "c1" })];
  assert.equal(filterUnscheduledApprovedContent(approved, []).length, 1);
  const afterSchedule: Pick<MarketingPublication, "contentId" | "platform" | "status">[] = [
    { contentId: "c1", platform: "instagram", status: "scheduled" },
  ];
  assert.equal(filterUnscheduledApprovedContent(approved, afterSchedule).length, 0);
});
