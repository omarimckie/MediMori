import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  allowMarketingDemoSeed,
  cronAuthDecision,
  resolveMarketingStoreMode,
} from "./config";
import { marketingAuthError } from "./auth-guard";
import { MemoryMarketingStore } from "./memory-store";
import { inferPreferenceSignals } from "./preference-signals";
import { MockSocialPublisher } from "./publishers";
import { scanMarketingText } from "./safety";
import { seedMarketing } from "./seed";
import { buildTrackingRedirect, persistMarketingClick } from "./tracking";
import {
  approveContent,
  editContent,
  publishPublication,
  regenerateItem,
  rejectContent,
  retryPublication,
  scheduleApproved,
} from "./approval";
import { generateWeeklyContent } from "./content-engine";
import { createCampaignFromObjective, getChannelQuotas } from "./planner";
import { generateRecommendations } from "./recommendations";
import { recordMockMetrics } from "./attribution";
import { buildWeeklyPlan } from "./planner";
import { ensureCatalogAssets } from "./assets";
import { createCampaignWorkflow } from "./workflow";
import type { MarketingPublication } from "./types";

const originalEnv = {
  mock: process.env.MARKETING_MOCK_MODE,
  vercel: process.env.VERCEL_ENV,
  store: process.env.MARKETING_STORE,
  database: process.env.DATABASE_URL,
};

afterEach(() => {
  process.env.MARKETING_MOCK_MODE = originalEnv.mock;
  process.env.VERCEL_ENV = originalEnv.vercel;
  process.env.MARKETING_STORE = originalEnv.store;
  process.env.DATABASE_URL = originalEnv.database;
});

test("authorization helper rejects unauthenticated access", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
  assert.equal(marketingAuthError(true), null);
});

test("campaign creation from an objective uses catalog books", async () => {
  const store = new MemoryMarketingStore();
  const campaign = await createCampaignFromObjective(store, {
    objective: "Promote the Sickle Cell book for 30 days.",
  });
  assert.equal(campaign.bookIds.includes("book-one"), true);
  assert.equal(campaign.status, "active");
  assert.match(campaign.coreMessage, /Amara|sickle cell/i);
  const events = await store.listEvents();
  assert.equal(events.some((item) => item.name === "campaign_created"), true);
});

test("weekly generation creates platform-specific content and cost logs", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const campaign = await createCampaignWorkflow(store, "Promote the Sickle Cell book for 30 days.");
  await ensureCatalogAssets(store);
  const plan = await buildWeeklyPlan(store, campaign);
  const quotas = await getChannelQuotas(store);
  const content = await generateWeeklyContent(store, campaign, plan, quotas);
  assert.ok(content.length >= 20);
  const instagram = content.filter((item) => item.platform === "instagram");
  const facebook = content.filter((item) => item.platform === "facebook");
  assert.notEqual(instagram[0]?.body, facebook[0]?.body);
  assert.equal(content.every((item) => item.status === "needs_review"), true);
  const ops = await store.listOperations();
  assert.equal(ops.some((item) => item.operation === "create_campaign"), true);
  assert.equal(ops[0]?.estimatedCostUsd, 0);
});

test("approval, edit, rejection, and preference signals", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const [item] = await store.listContent({ status: "needs_review" });
  assert.ok(item);

  const approved = await approveContent(store, item.id, "omari");
  assert.equal(approved?.status, "approved");

  const edited = await editContent(
    store,
    item.id,
    "Talking to your child about sickle cell doesn't have to feel scary.",
    "omari",
  );
  assert.ok(edited.signals.some((signal) => /warmer|conversational/i.test(signal.statement)));

  const other = (await store.listContent({ status: "needs_review" }))[0];
  assert.ok(other);
  const rejected = await rejectContent(store, other.id, "omari", "Too instructional");
  assert.equal(rejected?.status, "rejected");
  const events = await store.listEvents();
  assert.equal(events.some((entry) => entry.name === "content_approved"), true);
  assert.equal(events.some((entry) => entry.name === "content_rejected"), true);
  assert.equal(events.some((entry) => entry.name === "content_edited"), true);
});

test("regenerate keeps the item in review", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent({ status: "needs_review" }))[0];
  const regenerated = await regenerateItem(store, item.id, "omari");
  assert.equal(regenerated.status, "needs_review");
  assert.match(regenerated.body, /Regenerated variant/);
});

test("publishing is idempotent and retries transient failures", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent({ status: "needs_review" }))[0];
  await approveContent(store, item.id, "omari");
  const first = await scheduleApproved(store, item.id);
  const second = await scheduleApproved(store, item.id);
  assert.equal(first.id, second.id);

  const failed = await publishPublication(store, first, { simulateFailure: true });
  assert.equal(failed.status, "failed");
  assert.ok((failed.attemptCount ?? 0) >= 1);

  const retried = await retryPublication(store, failed.id);
  assert.equal(retried.status, "published");
  const again = await retryPublication(store, retried.id);
  assert.equal(again.externalId, retried.externalId);
});

test("mock publisher can succeed without live networks", async () => {
  const publisher = new MockSocialPublisher();
  const publication = {
    id: "pub",
    contentId: "c1",
    campaignId: "camp",
    platform: "instagram",
    provider: "mock",
    status: "scheduled",
    idempotencyKey: "k1",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies MarketingPublication;
  const result = await publisher.publish({
    content: {
      id: "c1",
      campaignId: "camp",
      weeklyPlanId: null,
      platform: "instagram",
      format: "post",
      category: "educational",
      audience: "parents",
      status: "scheduled",
      title: "Hello",
      body: "Warm copy",
      cta: "Read",
      seoTitle: null,
      seoDescription: null,
      scheduledFor: null,
      timezone: "America/New_York",
      assetIds: [],
      needsNewAsset: false,
      warnings: [],
      safetyFlags: [],
      trackingToken: "abc",
      originalBody: "Warm copy",
      bookId: "book-one",
      isDemo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    publication,
  });
  assert.equal(result.ok, true);
});

test("analytics recording and recommendations stay labeled as recommendations", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const campaign = (await store.listCampaigns())[0];
  await recordMockMetrics(store, campaign.id);
  const recs = await generateRecommendations(store, campaign.id);
  assert.ok(recs.length >= 1);
  assert.ok(["limited", "supporting", "strong"].includes(recs[0].evidenceStrength));
  const metrics = await store.listMetrics(campaign.id);
  assert.ok(metrics.length >= 1);
  assert.equal(metrics[0].source, "mock");
});

test("safety scanner flags invented statistics and mixed discount language", () => {
  const flags = scanMarketingText(
    "Studies show 90% of children improve. Use 10% off on Amazon paperbacks.",
  );
  assert.ok(flags.some((flag) => flag.code === "possible_medical_statistic"));
  assert.ok(flags.some((flag) => flag.code === "discount_channel_mix"));
});

test("preference inference does not auto-promote a global rule", () => {
  const signals = inferPreferenceSignals(
    "Help your child understand sickle cell.",
    "Talking to your child about sickle cell doesn't have to feel scary.",
  );
  assert.ok(signals.length >= 1);
  assert.equal(signals.every((signal) => signal.strength === "signal"), true);
});

test("channel quotas are configurable and not hardcoded as business law", async () => {
  const store = new MemoryMarketingStore();
  await store.setSetting("channel_quotas", {
    instagram: 2,
    facebook: 1,
    pinterest: 1,
    email: 1,
    website: 1,
    google: 1,
  });
  const quotas = await getChannelQuotas(store);
  assert.equal(quotas.instagram, 2);
  assert.equal(quotas.facebook, 1);
});

test("repeated tracking clicks record and redirect even if persist fails", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent())[0];
  assert.ok(item.trackingToken);

  const first = await persistMarketingClick(store, item, item.trackingToken);
  const second = await persistMarketingClick(store, item, item.trackingToken);
  assert.equal(first, true);
  assert.equal(second, true);
  const clicks = await store.listClicks();
  assert.equal(clicks.filter((click) => click.token === item.trackingToken).length, 2);

  const redirect = buildTrackingRedirect("http://localhost:3000/api/m/token", item);
  assert.equal(redirect.pathname, `/books/${item.bookId}`);
  assert.equal(redirect.searchParams.get("utm_medium"), "marketing_autopilot");

  const failingStore = {
    async recordClick() {
      throw new Error("click write failed");
    },
    async recordEvent() {
      throw new Error("should not be reached if click throws");
    },
  } as unknown as MemoryMarketingStore;
  const persisted = await persistMarketingClick(failingStore, item, item.trackingToken);
  assert.equal(persisted, false);
  const stillRedirects = buildTrackingRedirect("http://localhost:3000/api/m/token", item);
  assert.equal(stillRedirects.pathname, `/books/${item.bookId}`);
});

test("metric upsert updates the same content/date/source row", async () => {
  const store = new MemoryMarketingStore();
  const base = {
    campaignId: "camp-1",
    platform: "pinterest" as const,
    metricDate: "2026-09-18",
    impressions: 10,
    engagements: 2,
    clicks: 1,
    emailOpens: 0,
    emailClicks: 0,
    websiteSessions: 1,
    bookPageViews: 1,
    attributedPurchases: 0,
    source: "mock" as const,
  };
  const first = await store.upsertMetric({
    ...base,
    id: crypto.randomUUID(),
    contentId: "content-1",
  });
  const second = await store.upsertMetric({
    ...base,
    id: crypto.randomUUID(),
    contentId: "content-1",
    impressions: 40,
    engagements: 8,
    clicks: 4,
  });
  const other = await store.upsertMetric({
    ...base,
    id: crypto.randomUUID(),
    contentId: "content-1",
    metricDate: "2026-09-19",
    impressions: 5,
  });
  const metrics = await store.listMetrics();
  assert.equal(metrics.length, 2);
  assert.equal(second.id, first.id);
  assert.equal(second.impressions, 40);
  assert.equal(other.impressions, 5);
  assert.notEqual(other.id, first.id);
});

test("production store config cannot silently use memory", () => {
  assert.equal(resolveMarketingStoreMode({ MARKETING_STORE: "memory" }), "memory");
  assert.equal(
    resolveMarketingStoreMode({ VERCEL_ENV: "production", DATABASE_URL: "postgres://example" }),
    "postgres",
  );
  assert.throws(
    () => resolveMarketingStoreMode({ VERCEL_ENV: "production", MARKETING_STORE: "memory" }),
    /memory is not allowed/,
  );
  assert.throws(
    () => resolveMarketingStoreMode({ VERCEL_ENV: "production" }),
    /DATABASE_URL is required/,
  );
});

test("cron authentication fails closed in production", () => {
  assert.equal(
    cronAuthDecision({
      isProduction: true,
      cronSecret: "s3cret",
      authorizationHeader: "Bearer s3cret",
      isAdmin: false,
    }).ok,
    true,
  );
  assert.equal(
    cronAuthDecision({
      isProduction: true,
      cronSecret: null,
      authorizationHeader: null,
      isAdmin: false,
    }).ok,
    false,
  );
  assert.equal(
    cronAuthDecision({
      isProduction: true,
      cronSecret: "s3cret",
      authorizationHeader: "Bearer wrong",
      isAdmin: false,
    }).ok,
    false,
  );
  assert.equal(
    cronAuthDecision({
      isProduction: true,
      cronSecret: "s3cret",
      authorizationHeader: null,
      isAdmin: false,
    }).ok,
    false,
  );
  assert.equal(
    cronAuthDecision({
      isProduction: true,
      cronSecret: "s3cret",
      authorizationHeader: null,
      isAdmin: true,
    }).ok,
    true,
  );
});

test("only one worker can claim a scheduled publication", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent({ status: "needs_review" }))[0];
  await approveContent(store, item.id, "omari");
  const publication = await scheduleApproved(store, item.id);
  const again = await scheduleApproved(store, item.id);
  assert.equal(again.id, publication.id);
  const [first, second] = await Promise.all([
    store.claimPublication(publication.id),
    store.claimPublication(publication.id),
  ]);
  const claimed = [first, second].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.status, "processing");
  assert.equal(await store.claimPublication(publication.id), null);

  const published = await publishPublication(store, claimed[0]!);
  assert.equal(published.status, "published");
  const replay = await publishPublication(store, published);
  assert.equal(replay.externalId, published.externalId);
});

test("flagged edits stay in review and approval uses the final body", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent({ status: "needs_review" }))[0];
  const safe = await editContent(
    store,
    item.id,
    "Talking to your child about sickle cell doesn't have to feel scary.",
    "omari",
  );
  assert.equal(safe.content?.status, "needs_review");
  assert.equal(safe.content?.safetyFlags.length, 0);

  await approveContent(store, item.id, "omari");
  const flagged = await editContent(
    store,
    item.id,
    "Studies show 90% of children improve after this book.",
    "omari",
  );
  assert.equal(flagged.content?.status, "needs_review");
  assert.ok(flagged.content?.safetyFlags.some((flag) => flag.code === "possible_medical_statistic"));

  const approved = await approveContent(store, item.id, "omari");
  assert.equal(approved?.status, "approved");
  assert.match(approved?.body ?? "", /Studies show 90%/);
});

test("demo seed is disabled in production", () => {
  assert.equal(allowMarketingDemoSeed({}), true);
  assert.equal(allowMarketingDemoSeed({ VERCEL_ENV: "preview" }), true);
  assert.equal(allowMarketingDemoSeed({ VERCEL_ENV: "production" }), false);
});
