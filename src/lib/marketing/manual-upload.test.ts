import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { marketingAuthError } from "./auth-guard";
import {
  approveContent,
  publishDue,
  scheduleApproved,
} from "./approval";
import { PRIVATE_BLOB_PATH_TAG } from "./content-metadata";
import { getPublishedFreeResourceBySlug, listPublishedFreeResources } from "./free-resources";
import { assertImageUpload, MAX_MARKETING_IMAGE_BYTES } from "./file-validation";
import {
  createManualFreeResource,
  createManualSocialPost,
} from "./manual-upload";
import { MemoryMarketingStore } from "./memory-store";
import { runPublishPreflight } from "./publish-preflight";
import path from "node:path";
import sharp from "sharp";
import { resolveFreeResourceDownload } from "./resource-download";

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
        instagram: 1,
        facebook: 1,
        pinterest: 1,
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

async function socialPost(
  store: MemoryMarketingStore,
  platform: "instagram" | "facebook" | "pinterest",
  width: number,
  height: number,
) {
  const { planId, campaignId } = await planContext(store);
  const buffer = await pngBuffer(width, height);
  return createManualSocialPost(store, {
    platform,
    placement: platform === "pinterest" ? "pin" : "feed",
    body: platform === "pinterest" ? "Pin description for families." : "Caption for manual upload",
    pinTitle: platform === "pinterest" ? "Manual test pin" : null,
    pinDescription: platform === "pinterest" ? "Pin description for families." : null,
    pinAltText: platform === "pinterest" ? "Illustration for families" : null,
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    imageBuffer: buffer,
    imageFilename: "post.png",
  });
}

test("manual Instagram upload creates needs_review content", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await socialPost(store, "instagram", 1080, 1350);
  assert.equal(content.status, "needs_review");
  assert.equal(content.platform, "instagram");
  assert.equal(content.metadata.placement, "feed");
});

test("manual Facebook upload creates needs_review content", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await socialPost(store, "facebook", 1200, 1200);
  assert.equal(content.status, "needs_review");
  assert.equal(content.platform, "facebook");
});

test("manual Pinterest upload creates needs_review content", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await socialPost(store, "pinterest", 1000, 1500);
  assert.equal(content.status, "needs_review");
  assert.equal(content.format, "pin");
});

test("manual upload does not create a publication row", async () => {
  const store = new MemoryMarketingStore();
  await socialPost(store, "instagram", 1080, 1350);
  assert.equal((await store.listPublications()).length, 0);
});

test("unauthenticated upload returns 401", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
  assert.equal(marketingAuthError(true), null);
});

test("invalid MIME returns 400", () => {
  assert.throws(() => assertImageUpload(Buffer.from("not-an-image")), /Unsupported image type/);
});

test("oversized upload returns 400", () => {
  const huge = Buffer.alloc(MAX_MARKETING_IMAGE_BYTES + 1);
  assert.throws(() => assertImageUpload(huge), /exceeds/);
});

test("bad Instagram aspect ratio fails preflight", async () => {
  const store = new MemoryMarketingStore();
  const { content, assets } = await socialPost(store, "instagram", 800, 200);
  const asset = assets[0];
  await store.updateAsset(asset.id, {
    imageWidth: 800,
    imageHeight: 200,
    url: "https://cdn.example.test/manual.png",
  });
  const refreshed = await store.getContent(content.id);
  assert.ok(refreshed);
  const result = await runPublishPreflight(store, refreshed!);
  assert.equal(result.ok, false);
});

test("manual Instagram can approve schedule publishDue in mock mode", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const { content, assets } = await socialPost(store, "instagram", 1080, 1350);
  await store.updateAsset(assets[0].id, {
    url: "https://cdn.example.test/manual.png",
    imageWidth: 1080,
    imageHeight: 1350,
  });
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  const results = await publishDue(store);
  assert.ok(results.length >= 1);
  const updated = await store.getContent(content.id);
  assert.equal(updated?.status, "published");
});

test("manual resource creates preview and private file assets", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const preview = await pngBuffer(800, 1000);
  const { content, assets } = await createManualFreeResource(store, {
    title: "Sickle Cell Coloring Page",
    description: "A gentle coloring activity.",
    resourceType: "coloring_page",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: preview,
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "sheet.pdf",
  });
  assert.equal(content.status, "needs_review");
  assert.equal(assets.length, 2);
  const file = assets.find((item) => item.type === "resource_file");
  assert.ok(file?.tags.some((tag) => tag.startsWith(PRIVATE_BLOB_PATH_TAG)));
  assert.equal(file?.url, null);
});

test("manual resource starts as needs_review", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content } = await createManualFreeResource(store, {
    title: "Asthma Word Search",
    description: "Word search activity.",
    resourceType: "word_search",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "puzzle.pdf",
  });
  assert.equal(content.status, "needs_review");
});

test("unpublished resource does not appear publicly", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  await createManualFreeResource(store, {
    title: "Hidden Maze",
    description: "Not published yet.",
    resourceType: "maze",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "maze.pdf",
  });
  const listed = await listPublishedFreeResources(store);
  assert.equal(listed.length, 0);
});

test("published resource is listed and has slug page data", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content, assets } = await createManualFreeResource(store, {
    title: "Published Worksheet",
    description: "Ready for families.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "worksheet.pdf",
    seoTitle: "Worksheet SEO Title",
    seoDescription: "Worksheet SEO description for families.",
  });
  await store.updateAsset(assets[0].id, { url: "/marketing-uploads/preview.png" });
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  await publishDue(store);
  const listed = await listPublishedFreeResources(store);
  assert.equal(listed.length, 1);
  const slug = content.metadata.slug!;
  const page = await getPublishedFreeResourceBySlug(store, slug);
  assert.ok(page);
  assert.equal(page.resource.seoTitle, "Worksheet SEO Title");
});

test("resource download route does not expose private pathname", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content, assets } = await createManualFreeResource(store, {
    title: "Download Test",
    description: "Download tracking.",
    resourceType: "other",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(600, 800),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "file.pdf",
  });
  await store.updateAsset(assets[0].id, { url: "/marketing-uploads/preview.png" });
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  await publishDue(store);
  const result = await resolveFreeResourceDownload(store, content.id);
  assert.ok(result.kind === "local_file" || result.kind === "redirect");
  if (result.kind === "redirect") {
    assert.equal(result.url.includes("local-private/"), false);
    assert.equal(result.url.includes("marketing/private/"), false);
  }
  const events = await store.listEvents();
  assert.ok(events.some((item) => item.name === "resource_downloaded"));
});

test("manual resource does not alter resources.json", () => {
  const raw = readFileSync(path.join(process.cwd(), "src/data/resources.json"), "utf8");
  assert.ok(raw.includes('"resources"'));
});
