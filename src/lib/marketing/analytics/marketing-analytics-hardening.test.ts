import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryMarketingStore } from "../memory-store";
import { buildMarketingAnalyticsDashboard } from "./analytics-aggregation";
import { resolveAnalyticsReportingPeriod, calendarDayInTimezone } from "./analytics-time";
import { parseAnalyticsAnchorParam, parseAnalyticsWindowParam } from "./analytics-query";
import { buildPriorDayAnalyticsSummary } from "./prior-day-analytics-summary";

test("parseAnalyticsAnchorParam rejects invalid calendar dates", () => {
  assert.equal(parseAnalyticsAnchorParam("2026-13-40"), undefined);
  assert.equal(parseAnalyticsAnchorParam("not-a-date"), undefined);
  assert.ok(parseAnalyticsAnchorParam("2026-03-09"));
});

test("parseAnalyticsWindowParam defaults to week", () => {
  assert.equal(parseAnalyticsWindowParam(null), "week");
  assert.equal(parseAnalyticsWindowParam("day"), "day");
  assert.equal(parseAnalyticsWindowParam("invalid"), "week");
});

test("DST spring-forward day still yields a single local day key", () => {
  const tz = "America/New_York";
  const period = resolveAnalyticsReportingPeriod(
    "day",
    new Date("2026-03-09T12:00:00.000Z"),
    tz,
  );
  assert.equal(period.dayKeys.length, 1);
  assert.equal(period.dayKeys[0], calendarDayInTimezone(new Date("2026-03-09T12:00:00.000Z"), tz));
});

test("repeated tracked clicks are counted and mock metrics stay out of social engagement", async () => {
  const store = new MemoryMarketingStore();
  const contentId = "repeat-clicks";
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "published",
    title: "IG",
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
    trackingToken: "tok",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: true,
  });
  await store.recordClick({
    token: "a",
    contentId,
    campaignId: null,
    bookId: "book-one",
    destinationPath: "/books/book-one",
  });
  await store.recordClick({
    token: "b",
    contentId,
    campaignId: null,
    bookId: "book-one",
    destinationPath: "/books/book-one",
  });
  await store.upsertMetric({
    id: "mock-m",
    contentId,
    campaignId: null,
    platform: "instagram",
    metricDate: new Date().toISOString().slice(0, 10),
    impressions: 999,
    engagements: 999,
    clicks: 0,
    emailOpens: 0,
    emailClicks: 0,
    websiteSessions: 0,
    bookPageViews: 0,
    attributedPurchases: 0,
    source: "mock",
  });

  const dashboard = await buildMarketingAnalyticsDashboard({ store, window: "week" });
  assert.equal(dashboard.measured.trackedLinkClicks, 2);
  assert.equal(dashboard.socialEngagement.instagram.source, "unavailable");
  assert.equal(dashboard.socialEngagement.instagram.engagements, null);
  assert.ok(dashboard.syntheticMetricsRollup.included);
  assert.equal(
    dashboard.postPerformance.find((row) => row.contentId === contentId)?.engagementSource,
    "synthetic_mock",
  );
});

test("invalid destination paths produce partial-data warning", async () => {
  const store = new MemoryMarketingStore();
  await store.recordClick({
    token: "x",
    contentId: null,
    campaignId: null,
    bookId: null,
    destinationPath: "https://evil.example/phish",
  });
  const dashboard = await buildMarketingAnalyticsDashboard({ store, window: "week" });
  assert.ok(dashboard.partialDataWarnings.some((w) => /allowlist/i.test(w)));
});

test("empty reporting window warns when no measured activity", async () => {
  const store = new MemoryMarketingStore();
  const dashboard = await buildMarketingAnalyticsDashboard({
    store,
    window: "day",
    anchor: new Date("2020-01-01T12:00:00.000Z"),
  });
  assert.ok(dashboard.partialDataWarnings.some((w) => /No measured marketing activity/i.test(w)));
});

test("prior-day summary never includes synthetic metric totals", async () => {
  const store = new MemoryMarketingStore();
  const summary = await buildPriorDayAnalyticsSummary(store);
  const text = summary.lines.join(" ");
  assert.equal(text.includes("impressions"), false);
  assert.equal(text.includes("999"), false);
  assert.equal(summary.measuredOnly, true);
});
