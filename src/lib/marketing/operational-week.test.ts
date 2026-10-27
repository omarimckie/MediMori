import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_WEEK_MESSAGE,
  pickOperationalWeeklyPlanId,
  resolveWeeklyPlanSelection,
} from "./content-client-utils";
import { createEmptyWeeklyPlan } from "./empty-weekly-plan";
import { MemoryMarketingStore } from "./memory-store";
import { createCampaignWorkflow, generateWeekWorkflow } from "./workflow";
import { resolveSmartUploadPairForContent } from "./content-assign-week";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import type { MarketingContent } from "./types";
import {
  classifyMarketingWeek,
  nextMondayDefault,
  normalizeToWeekMonday,
  parseMarketingDateOnly,
  WeeklyPlanDateError,
} from "./weekly-plan-dates";

test("nextMondayDefault: Sunday 2026-10-04 → Monday 2026-10-05", () => {
  const sunday = new Date("2026-10-04T15:00:00.000Z");
  assert.equal(nextMondayDefault(sunday), "2026-10-05");
});

test("nextMondayDefault: Monday returns same Monday", () => {
  const monday = new Date("2026-10-05T12:00:00.000Z");
  assert.equal(nextMondayDefault(monday), "2026-10-05");
});

test("nextMondayDefault: Wednesday returns following Monday", () => {
  const wednesday = new Date("2026-10-07T12:00:00.000Z");
  assert.equal(nextMondayDefault(wednesday), "2026-10-12");
});

test("normalizeToWeekMonday maps mid-week date to Monday", () => {
  assert.equal(normalizeToWeekMonday("2026-10-08"), "2026-10-05");
});

test("parseMarketingDateOnly rejects malformed dates", () => {
  assert.throws(() => parseMarketingDateOnly("10/05/2026"), WeeklyPlanDateError);
  assert.throws(() => parseMarketingDateOnly("2026-13-01"), WeeklyPlanDateError);
});

test("classifyMarketingWeek on 2026-10-04", () => {
  const today = "2026-10-04";
  assert.equal(classifyMarketingWeek("2026-09-14", today), "past");
  assert.equal(classifyMarketingWeek("2026-09-29", today), "current");
  assert.equal(classifyMarketingWeek("2026-10-05", today), "upcoming");
});

test("createEmptyWeeklyPlan: campaign-less, no content, idempotent", async () => {
  const store = new MemoryMarketingStore();
  const first = await createEmptyWeeklyPlan(store, { weekStart: "2026-10-05" });
  assert.equal(first.created, true);
  assert.equal(first.normalizedWeekStart, "2026-10-05");
  assert.equal(first.plan.campaignId, null);
  assert.equal(first.plan.summary.itemCount, 0);

  const content = await store.listContent({ weeklyPlanId: first.plan.id });
  assert.equal(content.length, 0);
  const publications = await store.listPublications();
  assert.equal(publications.length, 0);

  const second = await createEmptyWeeklyPlan(store, { weekStart: "2026-10-05" });
  assert.equal(second.created, false);
  assert.equal(second.plan.id, first.plan.id);
});

test("duplicate campaign-less week reuses plan even when date normalizes", async () => {
  const store = new MemoryMarketingStore();
  const first = await createEmptyWeeklyPlan(store, { weekStart: "2026-10-07" });
  assert.equal(first.normalizedWeekStart, "2026-10-05");
  const second = await createEmptyWeeklyPlan(store, { weekStart: "2026-10-05" });
  assert.equal(second.plan.id, first.plan.id);
});

test("campaign generate week regression still creates content", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const campaign = await createCampaignWorkflow(store, "Promote sickle cell awareness.");
  const result = await generateWeekWorkflow(store, campaign.id);
  assert.ok(result.content.length > 0);
  assert.equal(result.plan.campaignId, campaign.id);
});

test("campaign and campaign-less plans may coexist for same week_start", async () => {
  const store = new MemoryMarketingStore();
  const campaign = await createCampaignWorkflow(store, "Promote sickle cell awareness.");
  const generated = await generateWeekWorkflow(store, campaign.id);
  const empty = await createEmptyWeeklyPlan(store, { weekStart: generated.plan.weekStart });
  assert.notEqual(empty.plan.id, generated.plan.id);
  assert.equal(empty.plan.campaignId, null);
});

test("pickOperationalWeeklyPlanId prefers upcoming over historical", () => {
  const plans = [
    { id: "sep14", weekStart: "2026-09-14" },
    { id: "oct5", weekStart: "2026-10-05" },
  ];
  assert.equal(pickOperationalWeeklyPlanId(plans, "2026-10-04"), "oct5");
});

test("pickOperationalWeeklyPlanId prefers current week when present", () => {
  const plans = [
    { id: "sep29", weekStart: "2026-09-29" },
    { id: "oct5", weekStart: "2026-10-05" },
  ];
  assert.equal(pickOperationalWeeklyPlanId(plans, "2026-10-04"), "sep29");
});

test("resolveWeeklyPlanSelection keeps selection across refresh", () => {
  const plans = [
    { id: "sep14", weekStart: "2026-09-14" },
    { id: "oct5", weekStart: "2026-10-05" },
  ];
  assert.equal(
    resolveWeeklyPlanSelection(plans, { currentSelectedId: "sep14" }),
    "sep14",
  );
});

test("resolveWeeklyPlanSelection prefers newly created plan id", () => {
  const plans = [
    { id: "sep14", weekStart: "2026-09-14" },
    { id: "oct5", weekStart: "2026-10-05" },
  ];
  assert.equal(
    resolveWeeklyPlanSelection(plans, { preferredPlanId: "oct5" }),
    "oct5",
  );
});

test("empty week message constant", () => {
  assert.match(EMPTY_WEEK_MESSAGE, /No content has been added/i);
});

test("Smart Upload pair resolution unchanged for IG+FB", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "finalize-key";
  const assetId = crypto.randomUUID();
  await store.createAsset({
    id: assetId,
    name: "Smart asset",
    type: "image",
    source: "upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: false,
    usageRestrictions: null,
    aspectRatio: "4:5",
    imageWidth: 1000,
    imageHeight: 1250,
    mimeType: "image/png",
    tags: [],
    url: "https://example.test/image.png",
    altText: null,
    isDemo: true,
  });
  const now = new Date().toISOString();
  const ig: MarketingContent = {
    id: crypto.randomUUID(),
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "IG",
    body: "Body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [assetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {
      source: SMART_UPLOAD_SOURCE,
      smartUploadFinalizeKey: finalizeKey,
      batchId: "batch-1",
    },
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  };
  const fb: MarketingContent = { ...ig, id: crypto.randomUUID(), platform: "facebook", title: "FB" };
  await store.createContent(ig);
  await store.createContent(fb);
  const pair = await resolveSmartUploadPairForContent(store, ig);
  assert.equal(pair.kind, "complete");
  if (pair.kind === "complete") {
    assert.equal(pair.instagramId, ig.id);
    assert.equal(pair.facebookId, fb.id);
  }
});
