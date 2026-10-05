import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MemoryMarketingStore } from "../memory-store";
import { buildMorningMarketingBrief, calendarDayInTimezone } from "./morning-brief";
import {
  isValidMarketingNotificationDestination,
  normalizeMarketingNotificationDestination,
} from "./destination";
import { parseMorningBriefPreferences } from "./preferences";
import { parsePushSubscriptionBody } from "./subscription-payload";
import { DEFAULT_MORNING_BRIEF_PREFERENCES } from "./types";

test("normalizeMarketingNotificationDestination allows marketing admin paths only", () => {
  assert.equal(normalizeMarketingNotificationDestination("/admin/marketing/week"), "/admin/marketing/week");
  assert.equal(normalizeMarketingNotificationDestination("https://evil.com"), "/admin/marketing");
  assert.equal(normalizeMarketingNotificationDestination("//evil.com/path"), "/admin/marketing");
  assert.equal(normalizeMarketingNotificationDestination("/admin/login"), "/admin/marketing");
  assert.ok(isValidMarketingNotificationDestination("/admin/marketing/notifications"));
});

test("parsePushSubscriptionBody validates subscription shape", () => {
  assert.equal(parsePushSubscriptionBody(null), null);
  assert.equal(parsePushSubscriptionBody({ endpoint: "http://insecure" }), null);
  const ok = parsePushSubscriptionBody({
    endpoint: "https://push.example/abc",
    keys: { p256dh: "p", auth: "a" },
  });
  assert.ok(ok);
  assert.equal(ok?.endpoint, "https://push.example/abc");
});

test("morning brief preferences default to 7:00 AM America/New_York", () => {
  const prefs = parseMorningBriefPreferences(null);
  assert.deepEqual(prefs, DEFAULT_MORNING_BRIEF_PREFERENCES);
  assert.equal(prefs.morningBriefTime, "07:00");
  assert.equal(prefs.timezone, "America/New_York");
});

test("morning brief excludes synthetic metrics and uses real publication counts", async () => {
  const store = new MemoryMarketingStore();
  const timezone = "America/New_York";
  const todayKey = calendarDayInTimezone(new Date(), timezone);

  await store.createCampaign({
    id: "camp-1",
    name: "Test",
    objective: "Test",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "Test",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta: null,
    requiredAssets: [],
    measurementGoals: [],
    bookIds: ["book-one"],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: true,
  });

  const contentId = "content-1";
  await store.createContent({
    id: contentId,
    campaignId: "camp-1",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "T",
    body: "B",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: `${todayKey}T19:00:00.000Z`,
    timezone,
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: true,
  });

  await store.createPublication({
    id: "pub-1",
    contentId,
    campaignId: "camp-1",
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: "idem-1",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: `${todayKey}T19:00:00.000Z`,
    publishedAt: null,
  });

  await store.upsertMetric({
    id: "metric-mock",
    contentId,
    campaignId: "camp-1",
    platform: "instagram",
    metricDate: todayKey,
    impressions: 999,
    engagements: 999,
    clicks: 0,
    emailOpens: 0,
    emailClicks: 0,
    websiteSessions: 50,
    bookPageViews: 50,
    attributedPurchases: 0,
    source: "mock",
  });

  const brief = await buildMorningMarketingBrief(store);
  assert.ok(brief.excludedSyntheticMetrics.some((line) => /mock/i.test(line)));
  assert.equal(
    brief.today.some((line) => line.label === "posts scheduled"),
    true,
  );
  assert.equal(
    brief.yesterday.some((line) => /websiteSessions|impressions/i.test(line.label)),
    false,
  );
  assert.match(brief.payload.body, /Morning Brief/);
});

test("publishing pipeline files were not modified for notifications milestone", () => {
  const frozen = [
    "src/lib/marketing/approval.ts",
    "src/app/api/cron/marketing-publish/route.ts",
    ".github/workflows/marketing-publish-dispatch.yml",
    "vercel.json",
  ];
  for (const file of frozen) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("sendMarketingNotification"), false, file);
    assert.equal(text.includes("marketing_push_subscriptions"), false, file);
  }
});

test("send-marketing-notification does not import publishDue", () => {
  const text = readFileSync(
    "src/lib/marketing/notifications/send-marketing-notification.ts",
    "utf8",
  );
  assert.equal(/\bpublishDue\b/.test(text), false);
  assert.equal(/\bpublishPublication\b/.test(text), false);
});
