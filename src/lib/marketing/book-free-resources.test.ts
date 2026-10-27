import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { createManualFreeResource } from "./manual-upload";
import { listPublishedFreeResourcesForBook } from "./free-resources";
import { MemoryMarketingStore } from "./memory-store";

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

async function seedResource(
  store: MemoryMarketingStore,
  options: {
    title: string;
    bookId: string | null;
    status: "published" | "needs_review";
    slug: string;
  },
) {
  const { planId, campaignId } = await planContext(store);
  const { content } = await createManualFreeResource(store, {
    title: options.title,
    description: "Test resource description.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    bookId: options.bookId,
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "sheet.pdf",
  });
  await store.updateContent(content.id, {
    status: options.status,
    metadata: {
      ...content.metadata,
      slug: options.slug,
      resourcePublishedAt: options.status === "published" ? "2026-03-02T10:00:00.000Z" : null,
    },
  });
  return content.id;
}

test("matching published resource appears for book", async () => {
  const store = new MemoryMarketingStore();
  await seedResource(store, {
    title: "Sickle Cell Activity",
    bookId: "book-one",
    status: "published",
    slug: "sickle-cell-activity",
  });
  const rows = await listPublishedFreeResourcesForBook(store, "book-one");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.publicPath, "/resources/free/sickle-cell-activity");
});

test("unpublished resource does not appear for book", async () => {
  const store = new MemoryMarketingStore();
  await seedResource(store, {
    title: "Draft Activity",
    bookId: "book-one",
    status: "needs_review",
    slug: "draft-activity",
  });
  const rows = await listPublishedFreeResourcesForBook(store, "book-one");
  assert.equal(rows.length, 0);
});

test("resource for another book does not appear", async () => {
  const store = new MemoryMarketingStore();
  await seedResource(store, {
    title: "Asthma Activity",
    bookId: "book-three",
    status: "published",
    slug: "asthma-activity",
  });
  const rows = await listPublishedFreeResourcesForBook(store, "book-one");
  assert.equal(rows.length, 0);
});

test("book with no resources returns empty list", async () => {
  const store = new MemoryMarketingStore();
  const rows = await listPublishedFreeResourcesForBook(store, "book-one");
  assert.equal(rows.length, 0);
});

test("book resource links use public landing path not download API", async () => {
  const store = new MemoryMarketingStore();
  await seedResource(store, {
    title: "Coloring Page",
    bookId: "book-one",
    status: "published",
    slug: "coloring-page",
  });
  const rows = await listPublishedFreeResourcesForBook(store, "book-one");
  assert.match(rows[0]?.publicPath ?? "", /^\/resources\/free\/coloring-page$/);
  assert.doesNotMatch(rows[0]?.publicPath ?? "", /\/api\/resources\/free\//);
});
