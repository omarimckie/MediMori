import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, test } from "node:test";
import sharp from "sharp";
import { approveContent, publishDue, scheduleApproved } from "./approval";
import { createManualFreeResource } from "./manual-upload";
import { MemoryMarketingStore } from "./memory-store";
import { getPublishedFreeResourceBySlug } from "./free-resources";
import {
  FREE_RESOURCE_PREVIEW_CACHE_CONTROL,
  findDeliverableFreeResourcePreview,
  freeResourcePreviewApiPath,
  freeResourcePublicPreviewMedia,
  handleFreeResourcePreviewRequest,
  hasDeliverableFreeResourcePreview,
  resolveFreeResourcePreview,
  setPreviewBufferReaderForTests,
} from "./resource-preview";

const TEST_PREVIEW_PATH = `marketing/public/${"a".repeat(32)}.png`;

afterEach(() => {
  setPreviewBufferReaderForTests(null);
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

async function publishFreeResource(store: MemoryMarketingStore) {
  const { planId, campaignId } = await planContext(store);
  const previewBytes = await pngBuffer(400, 500);
  setPreviewBufferReaderForTests(async (pathname) => {
    assert.equal(pathname, TEST_PREVIEW_PATH);
    return previewBytes;
  });

  const { content, assets } = await createManualFreeResource(store, {
    title: "Preview Route Test",
    description: "Preview image delivery.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: previewBytes,
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4 test"),
    fileFilename: "sheet.pdf",
  });
  await store.updateAsset(assets[0].id, {
    url: `https://store-id.public.blob.vercel-storage.com/${TEST_PREVIEW_PATH}`,
  });
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  await publishDue(store);
  const published = await store.getContent(content.id);
  assert.ok(published);
  return { content: published, previewBytes };
}

test("published free resource with valid preview returns image bytes", async () => {
  const store = new MemoryMarketingStore();
  const { content, previewBytes } = await publishFreeResource(store);
  const result = await resolveFreeResourcePreview(store, content.id);
  assert.equal(result.kind, "image");
  if (result.kind !== "image") return;
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.buffer.length, previewBytes.length);
});

test("preview route handler returns image with cache headers", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const response = await handleFreeResourcePreviewRequest(store, content.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), FREE_RESOURCE_PREVIEW_CACHE_CONTROL);
  const length = response.headers.get("Content-Length");
  assert.ok(length && Number(length) > 0);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.length > 0);
});

test("missing resource returns 404", async () => {
  const store = new MemoryMarketingStore();
  const result = await resolveFreeResourcePreview(store, crypto.randomUUID());
  assert.equal(result.kind, "not_found");
  const response = await handleFreeResourcePreviewRequest(store, crypto.randomUUID());
  assert.equal(response.status, 404);
});

test("unpublished free resource returns 404", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content, assets } = await createManualFreeResource(store, {
    title: "Draft",
    description: "Not published.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(100, 100),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4"),
    fileFilename: "file.pdf",
  });
  await store.updateAsset(assets[0].id, { url: "/marketing-uploads/preview.png" });
  const result = await resolveFreeResourcePreview(store, content.id);
  assert.equal(result.kind, "not_found");
});

test("wrong content format returns 404", async () => {
  const store = new MemoryMarketingStore();
  const contentId = crypto.randomUUID();
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "published",
    title: "Social post",
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
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
  });
  const result = await resolveFreeResourcePreview(store, contentId);
  assert.equal(result.kind, "not_found");
});

test("missing preview asset returns 404", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const { content } = await createManualFreeResource(store, {
    title: "No preview url",
    description: "Missing preview.",
    resourceType: "worksheet",
    weeklyPlanId: planId,
    campaignId,
    actor: "owner",
    previewBuffer: await pngBuffer(100, 100),
    previewFilename: "preview.png",
    fileBuffer: Buffer.from("%PDF-1.4"),
    fileFilename: "file.pdf",
  });
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  await publishDue(store);
  const published = await store.getContent(content.id);
  assert.ok(published);
  await store.updateContent(content.id, { assetIds: [] });
  const result = await resolveFreeResourcePreview(store, content.id);
  assert.equal(result.kind, "not_found");
});

test("invalid preview blob pathname is rejected", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const assets = await store.listAssets();
  const preview = assets.find((row) => row.type === "resource_preview");
  assert.ok(preview);
  await store.updateAsset(preview.id, {
    url: "https://evil.example.com/not-a-blob.png",
  });
  const result = await resolveFreeResourcePreview(store, content.id);
  assert.equal(result.kind, "not_found");
});

test("unapproved preview asset is rejected", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const assets = await store.listAssets();
  const preview = assets.find((row) => row.type === "resource_preview");
  assert.ok(preview);
  await store.updateAsset(preview.id, { approved: false });
  const result = await resolveFreeResourcePreview(store, content.id);
  assert.equal(result.kind, "not_found");
});

test("private PDF file asset cannot be served as preview", async () => {
  const store = new MemoryMarketingStore();
  const { planId, campaignId } = await planContext(store);
  const contentId = crypto.randomUUID();
  const fileAssetId = crypto.randomUUID();
  const privatePath = `marketing/private/${"a".repeat(32)}.pdf`;
  await store.createAsset({
    id: fileAssetId,
    name: "file.pdf",
    type: "resource_file",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId,
    approved: true,
    usageRestrictions: null,
    aspectRatio: null,
    imageWidth: null,
    imageHeight: null,
    mimeType: "application/pdf",
    tags: [`private_blob_path:${privatePath}`, "resource_file"],
    url: null,
    altText: "file",
    isDemo: false,
  });
  await store.createContent({
    id: contentId,
    campaignId,
    weeklyPlanId: planId,
    platform: "website",
    format: "free_resource",
    category: "educational",
    audience: "parents",
    status: "published",
    title: "PDF only",
    body: "No image preview.",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [fileAssetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: { slug: "pdf-only-resource", resourceType: "worksheet" },
    isDemo: false,
  });
  const result = await resolveFreeResourcePreview(store, contentId);
  assert.equal(result.kind, "not_found");
});

test("freeResourcePreviewApiPath is stable per content id", () => {
  const id = "9a516220-5aff-4e6b-926d-102f2f3a9851";
  assert.equal(
    freeResourcePreviewApiPath(id),
    `/api/resources/free/${id}/preview`,
  );
});

test("deliverable preview uses stable API URLs for image and Open Graph", async () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const assets = await store.listAssets();
  assert.ok(hasDeliverableFreeResourcePreview(content, assets));
  const media = freeResourcePublicPreviewMedia(content.id, true);
  assert.ok(media);
  assert.equal(media.imageSrc, `/api/resources/free/${content.id}/preview`);
  assert.equal(
    media.openGraphImageUrl,
    `https://twilight-feather.com/api/resources/free/${content.id}/preview`,
  );
  assert.equal(media.imageSrc.includes("blob.vercel-storage.com"), false);
  assert.equal(media.openGraphImageUrl.includes("blob.vercel-storage.com"), false);
});

test("slug lookup exposes deliverable preview independent of legacy previewImageUrl field", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const slug = content.metadata.slug!;
  const row = await getPublishedFreeResourceBySlug(store, slug);
  assert.ok(row);
  assert.equal(row.hasDeliverablePreview, true);
  row.resource.previewImageUrl = null;
  const media = freeResourcePublicPreviewMedia(row.resource.id, row.hasDeliverablePreview);
  assert.ok(media);
  assert.equal(media.imageSrc, `/api/resources/free/${content.id}/preview`);
});

test("unapproved preview asset is not deliverable for public media", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const assets = await store.listAssets();
  const preview = assets.find((row) => row.type === "resource_preview");
  assert.ok(preview);
  await store.updateAsset(preview.id, { approved: false });
  assert.equal(hasDeliverableFreeResourcePreview(content, await store.listAssets()), false);
  assert.equal(freeResourcePublicPreviewMedia(content.id, false), null);
  const row = await getPublishedFreeResourceBySlug(store, content.metadata.slug!);
  assert.ok(row);
  assert.equal(row.hasDeliverablePreview, false);
});

test("invalid preview pathname is not deliverable for public media", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const assets = await store.listAssets();
  const preview = assets.find((row) => row.type === "resource_preview");
  assert.ok(preview);
  await store.updateAsset(preview.id, {
    url: "https://evil.example.com/not-a-blob.png",
  });
  assert.equal(findDeliverableFreeResourcePreview(content, await store.listAssets()), null);
  assert.equal(freeResourcePublicPreviewMedia(content.id, false), null);
});

test("missing preview asset yields no public preview media", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  await store.updateContent(content.id, { assetIds: [] });
  const refreshed = await store.getContent(content.id);
  assert.ok(refreshed);
  const assets = await store.listAssets();
  assert.equal(hasDeliverableFreeResourcePreview(refreshed, assets), false);
  assert.equal(freeResourcePublicPreviewMedia(content.id, false), null);
});

test("public preview media never uses raw blob asset URLs", async () => {
  const store = new MemoryMarketingStore();
  const { content } = await publishFreeResource(store);
  const assets = await store.listAssets();
  const preview = assets.find((row) => row.type === "resource_preview");
  assert.ok(preview);
  assert.ok(
    preview.url?.includes("blob.vercel-storage.com") ||
      preview.url?.startsWith("/marketing-uploads/"),
  );
  const media = freeResourcePublicPreviewMedia(content.id, true);
  assert.ok(media);
  assert.equal(media.imageSrc.includes(preview.url ?? ""), false);
  assert.equal(media.openGraphImageUrl.includes(preview.url ?? ""), false);
});
