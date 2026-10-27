import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { createManualFreeResource } from "./manual-upload";
import {
  comparePublishedFreeResources,
  listPublishedFreeResourceCatalog,
  listPublishedFreeResources,
  type PublishedFreeResource,
  sortPublishedFreeResources,
} from "./free-resources";
import { MemoryMarketingStore } from "./memory-store";
import {
  freeResourcePreviewApiPath,
  freeResourcePublicPreviewMedia,
} from "./resource-preview";

const TEST_PREVIEW_PATH = `marketing/public/${"a".repeat(32)}.png`;

function samplePublished(overrides: Partial<PublishedFreeResource> = {}): PublishedFreeResource {
  return {
    id: "id-1",
    slug: "sample",
    title: "Sample",
    description: "Desc",
    resourceType: "worksheet",
    resourceTypeLabel: "Worksheet",
    bookId: null,
    bookTitle: null,
    relatedCondition: null,
    seoTitle: "SEO",
    seoDescription: "SEO",
    previewImageUrl: null,
    publicPath: "/resources/free/sample",
    cta: null,
    publishedAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

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
        website: 0,
        google: 0,
      },
    },
    rationale: {},
    isDemo: true,
  });
  return { planId, campaignId };
}

test("comparePublishedFreeResources sorts publishedAt desc then title asc", () => {
  const newer = samplePublished({ title: "Zebra", publishedAt: "2026-03-02T00:00:00.000Z" });
  const older = samplePublished({ title: "Apple", publishedAt: "2026-03-01T00:00:00.000Z" });
  const sameDayA = samplePublished({ title: "Maze B", publishedAt: "2026-03-01T00:00:00.000Z" });
  const sameDayB = samplePublished({ title: "Maze A", publishedAt: "2026-03-01T00:00:00.000Z" });

  const sorted = sortPublishedFreeResources([older, newer, sameDayA, sameDayB]);
  assert.deepEqual(
    sorted.map((item) => item.title),
    ["Zebra", "Apple", "Maze A", "Maze B"],
  );
  assert.equal(comparePublishedFreeResources(sameDayB, sameDayA), -1);
});

test("listPublishedFreeResources excludes unpublished content", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content } = await createManualFreeResource(store, {
    title: "Draft Only",
    description: "Not live.",
    resourceType: "maze",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(400, 400),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "maze.pdf",
  });
  assert.equal(content.status, "needs_review");
  assert.equal((await listPublishedFreeResources(store)).length, 0);
  assert.equal((await listPublishedFreeResourceCatalog(store)).length, 0);
});

test("listPublishedFreeResourceCatalog returns published items with preview API paths", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content, assets } = await createManualFreeResource(store, {
    title: "Live Worksheet",
    description: "Published activity.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "sheet.pdf",
  });
  const previewAsset = assets.find((asset) => asset.type === "resource_preview");
  assert.ok(previewAsset);
  await store.updateAsset(previewAsset.id, {
    url: `https://store-id.public.blob.vercel-storage.com/${TEST_PREVIEW_PATH}`,
  });
  await store.updateContent(content.id, {
    status: "published",
    metadata: {
      ...content.metadata,
      slug: "live-worksheet",
      resourcePublishedAt: "2026-03-10T12:00:00.000Z",
    },
  });

  const catalog = await listPublishedFreeResourceCatalog(store);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.resource.title, "Live Worksheet");
  assert.equal(catalog[0]?.hasDeliverablePreview, true);

  const media = freeResourcePublicPreviewMedia(content.id, catalog[0]!.hasDeliverablePreview);
  assert.ok(media);
  assert.equal(media.imageSrc, freeResourcePreviewApiPath(content.id));
  assert.ok(!media.imageSrc.includes("blob.vercel-storage.com"));
});

test("free resources collection route page exists", () => {
  const pagePath = path.join(process.cwd(), "src/app/resources/free/page.tsx");
  assert.ok(existsSync(pagePath));
});
