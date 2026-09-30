import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import {
  approveContent,
  publishDue,
  publishPublication,
  scheduleApproved,
} from "./approval";
import { freeResourcePublicPath } from "./content-metadata";
import { setRevalidatePathForTests } from "./free-resource-cache";
import { getPublishedFreeResourceBySlug, listPublishedFreeResources } from "./free-resources";
import { createManualFreeResource } from "./manual-upload";
import { MemoryMarketingStore } from "./memory-store";
import { formatPublicationStatusLabel } from "./publication-display";
import { getSocialPublisher } from "./publishers";
import { absoluteUrl } from "@/lib/site";

const originalMockMode = process.env.MARKETING_MOCK_MODE;

beforeEach(() => {
  setRevalidatePathForTests(() => {});
});

afterEach(() => {
  setRevalidatePathForTests(null);
  if (originalMockMode === undefined) delete process.env.MARKETING_MOCK_MODE;
  else process.env.MARKETING_MOCK_MODE = originalMockMode;
});

async function pngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 220, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

async function planContext(store: MemoryMarketingStore) {
  const planId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  await store.createCampaign({
    id: campaignId,
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
  await store.createWeeklyPlan({
    id: planId,
    campaignId,
    weekStart: "2026-01-05",
    status: "ready",
    summary: {
      itemCount: 0,
      newAssetCount: 0,
      warningCount: 0,
      objective: "Test",
      audience: "parents",
      quotas: {
        instagram: 0,
        facebook: 0,
        pinterest: 0,
        email: 0,
        website: 1,
        google: 0,
      },
    },
    rationale: {},
    isDemo: true,
  });
  return { planId, campaignId };
}

async function seedFreeResource(store: MemoryMarketingStore) {
  const { planId, campaignId } = await planContext(store);
  const { content, assets } = await createManualFreeResource(store, {
    title: "Free Resource Publish Test",
    description: "Description for families.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "sheet.pdf",
  });
  await store.updateAsset(assets[0].id, { url: "/marketing-uploads/preview.png" });
  return content;
}

test("free resource schedules with provider website_free_resources in live mode", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  const content = await seedFreeResource(store);
  await approveContent(store, content.id, "owner");
  const publication = await scheduleApproved(store, content.id);
  assert.equal(publication.provider, "website_free_resources");
});

test("free resource schedules with website_free_resources even when global mock mode is on", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = await seedFreeResource(store);
  await approveContent(store, content.id, "owner");
  const publication = await scheduleApproved(store, content.id);
  assert.equal(publication.provider, "website_free_resources");
});

test("free resource publish uses WebsiteFreeResourcePublisher not mock social", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  const content = await seedFreeResource(store);
  await approveContent(store, content.id, "owner");
  const scheduled = await scheduleApproved(store, content.id);
  const revalidatedPaths: string[] = [];
  setRevalidatePathForTests((path) => {
    revalidatedPaths.push(path);
  });
  const published = await publishPublication(store, scheduled);
  assert.equal(published.provider, "website_free_resources");
  assert.equal(published.status, "published");
  const slug = content.metadata.slug!;
  assert.equal(published.externalId, slug);
  assert.equal(published.url, absoluteUrl(freeResourcePublicPath(slug)));
  assert.equal(
    formatPublicationStatusLabel({ status: "published", provider: published.provider }),
    "published",
  );
  const refreshed = await store.getContent(content.id);
  assert.equal(refreshed?.status, "published");
  assert.ok(refreshed?.metadata.resourcePublishedAt);
  const events = await store.listEvents();
  assert.ok(events.some((item) => item.name === "resource_published"));
  assert.deepEqual(revalidatedPaths, [
    "/resources/free",
    "/resources",
    "/sitemap.xml",
    freeResourcePublicPath(slug),
  ]);
});

test("free resource publish failure does not revalidate public routes", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  const content = await seedFreeResource(store);
  await approveContent(store, content.id, "owner");
  const scheduled = await scheduleApproved(store, content.id);
  await store.updateContent(content.id, {
    metadata: { ...content.metadata, slug: "" },
  });
  const revalidatedPaths: string[] = [];
  setRevalidatePathForTests((path) => {
    revalidatedPaths.push(path);
  });
  const failed = await publishPublication(store, scheduled);
  assert.equal(failed.status, "failed");
  assert.equal(revalidatedPaths.length, 0);
});

test("free resource publishDue leaves content published with slug for public listing", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  const content = await seedFreeResource(store);
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  await publishDue(store);
  const listed = await listPublishedFreeResources(store);
  assert.equal(listed.length, 1);
  const page = await getPublishedFreeResourceBySlug(store, content.metadata.slug!);
  assert.ok(page);
});

test("ordinary website article still uses social mock publisher in live mode", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const contentId = crypto.randomUUID();
  await store.createContent({
    id: contentId,
    campaignId,
    weeklyPlanId: planId,
    platform: "website",
    format: "article",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Blog post",
    body: "Article body",
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
  });
  const publication = await scheduleApproved(store, contentId);
  assert.equal(publication.provider, "mock_social");
  assert.equal(getSocialPublisher("website").id, "mock_social");
});
