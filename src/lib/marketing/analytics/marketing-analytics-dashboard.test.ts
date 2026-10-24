import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryMarketingStore } from "../memory-store";
import { buildMarketingAnalyticsDashboard } from "./analytics-aggregation";
import {
  buildPriorDayAnalyticsNotificationPayload,
  buildPriorDayAnalyticsSummary,
} from "./prior-day-analytics-summary";
import { resolveAnalyticsReportingPeriod } from "./analytics-time";
import { sanitizeAttributionRows } from "./analytics-privacy";
import { attributePurchases } from "../attribution";

test("reporting period week contains seven day keys", () => {
  const period = resolveAnalyticsReportingPeriod("week", new Date("2026-10-23T15:00:00.000Z"));
  assert.equal(period.dayKeys.length, 7);
});

test("dashboard counts tracked clicks and labels mock metrics separately", async () => {
  const store = new MemoryMarketingStore();
  const contentId = "content-analytics-1";
  await store.createContent({
    id: contentId,
    campaignId: "camp-1",
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "published",
    title: "Post",
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
    token: "tok",
    contentId,
    campaignId: "camp-1",
    bookId: "book-one",
    destinationPath: "/books/book-one",
  });
  await store.upsertMetric({
    id: "m1",
    contentId,
    campaignId: "camp-1",
    platform: "facebook",
    metricDate: new Date().toISOString().slice(0, 10),
    impressions: 100,
    engagements: 10,
    clicks: 1,
    emailOpens: 0,
    emailClicks: 0,
    websiteSessions: 0,
    bookPageViews: 0,
    attributedPurchases: 0,
    source: "mock",
  });

  const dashboard = await buildMarketingAnalyticsDashboard({ store, window: "week" });
  assert.ok(dashboard.measured.trackedLinkClicks >= 1);
  assert.equal(dashboard.socialEngagement.facebook.source, "unavailable");
  assert.ok(dashboard.syntheticMetricsRollup.included);
  assert.ok(dashboard.partialDataWarnings.some((w) => /mock/i.test(w)));
  assert.ok(dashboard.platformAttribution.some((row) => row.platform === "Facebook"));
});

test("sanitizeAttributionRows omits purchase identifiers", async () => {
  const store = new MemoryMarketingStore();
  const rows = await attributePurchases(store, [
    {
      id: "purchase-secret-id",
      bookId: "book-one",
      purchasedAt: new Date().toISOString(),
      amountCents: 1000,
    },
  ]);
  const sanitized = sanitizeAttributionRows(rows);
  assert.equal(sanitized[0].bookId, "book-one");
  assert.equal("purchaseId" in (sanitized[0] as object), false);
});

test("prior-day analytics summary builds push preview without sending", async () => {
  const store = new MemoryMarketingStore();
  const summary = await buildPriorDayAnalyticsSummary(store);
  const payload = buildPriorDayAnalyticsNotificationPayload(summary);
  assert.match(payload.destination, /analytics/);
  assert.match(payload.body, /Measured analytics/i);
});
