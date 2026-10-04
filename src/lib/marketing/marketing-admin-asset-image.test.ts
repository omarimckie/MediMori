import assert from "node:assert/strict";
import { test } from "node:test";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import {
  marketingAdminAssetImageApiPath,
  resolveAdminContentPreviewImageUrl,
  resolveMarketingAdminAssetImage,
  setMarketingAdminAssetImageBufferReaderForTests,
} from "./marketing-admin-asset-image";
import {
  isMarketingAssetPublicImageEligible,
  resolveMarketingAssetPublicImage,
  setMarketingAssetPublicImageBufferReaderForTests,
} from "./marketing-asset-public-image";
import { MemoryMarketingStore } from "./memory-store";

const BLOB_URL =
  "https://example.test/marketing/public/dddddddddddddddddddddddddddddd.png";

async function seedNeedsReviewSmartUpload(store: MemoryMarketingStore) {
  const assetId = "b3a88242-2e91-4127-960f-43b047152aa9";
  await store.createAsset({
    id: assetId,
    name: "fixture.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: ["smart_upload"],
    url: BLOB_URL,
    altText: "alt",
    isDemo: true,
  });
  const contentId = "572b3ed9-ec64-4d23-9ccc-96bc1d7494bf";
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [assetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok",
    originalBody: null,
    bookId: null,
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "fk" },
    isDemo: true,
  });
  return { assetId, contentId };
}

test("admin preview enrichment returns admin image route for needs_review Smart Upload", async () => {
  const store = new MemoryMarketingStore();
  const { assetId, contentId } = await seedNeedsReviewSmartUpload(store);
  const content = await store.getContent(contentId);
  assert.ok(content);
  const previewUrl = await resolveAdminContentPreviewImageUrl(store, content);
  assert.equal(previewUrl, marketingAdminAssetImageApiPath(assetId));
  assert.doesNotMatch(previewUrl!, /vercel-storage|sig|token/i);
});

test("authenticated admin can retrieve needs_review Smart Upload image bytes", async () => {
  const store = new MemoryMarketingStore();
  const { assetId } = await seedNeedsReviewSmartUpload(store);
  const fake = Buffer.from("png-bytes");
  setMarketingAdminAssetImageBufferReaderForTests(async () => fake);
  const result = await resolveMarketingAdminAssetImage(store, assetId, { includeBody: true });
  setMarketingAdminAssetImageBufferReaderForTests(null);
  assert.equal(result.kind, "image");
  if (result.kind === "image") {
    assert.equal(result.buffer.toString(), "png-bytes");
    assert.equal(result.mimeType, "image/png");
  }
});

test("missing asset rejected", async () => {
  const store = new MemoryMarketingStore();
  const result = await resolveMarketingAdminAssetImage(store, crypto.randomUUID(), {
    includeBody: true,
  });
  assert.equal(result.kind, "not_found");
});

test("unsupported asset rejected", async () => {
  const store = new MemoryMarketingStore();
  const assetId = crypto.randomUUID();
  await store.createAsset({
    id: assetId,
    name: "bad.svg",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: null,
    imageWidth: null,
    imageHeight: null,
    mimeType: "image/svg+xml",
    tags: [],
    url: BLOB_URL,
    altText: "x",
    isDemo: true,
  });
  const result = await resolveMarketingAdminAssetImage(store, assetId, { includeBody: true });
  assert.equal(result.kind, "not_found");
});

test("public proxy still refuses needs_review-only asset", async () => {
  const store = new MemoryMarketingStore();
  const { assetId } = await seedNeedsReviewSmartUpload(store);
  const asset = await store.getAsset(assetId);
  assert.ok(asset);
  assert.equal(await isMarketingAssetPublicImageEligible(store, asset), false);
  setMarketingAssetPublicImageBufferReaderForTests(async () => Buffer.from("x"));
  const publicResult = await resolveMarketingAssetPublicImage(store, assetId, {
    includeBody: true,
  });
  setMarketingAssetPublicImageBufferReaderForTests(null);
  assert.equal(publicResult.kind, "not_found");
});

test("approved content still uses public proxy for publish URL resolution", async () => {
  const store = new MemoryMarketingStore();
  const { assetId, contentId } = await seedNeedsReviewSmartUpload(store);
  await store.updateContent(contentId, { status: "approved" });
  const content = await store.getContent(contentId);
  assert.ok(content);
  const { resolvePublishableMarketingAssetUrl } = await import("./marketing-asset-public-image-url");
  const asset = await store.getAsset(assetId);
  assert.ok(asset);
  const publishUrl = resolvePublishableMarketingAssetUrl(asset, "approved");
  assert.match(publishUrl, /\/api\/marketing\/assets\//);
});

test("Content thumbnail expected src path shape", () => {
  const path = marketingAdminAssetImageApiPath("b3a88242-2e91-4127-960f-43b047152aa9");
  assert.equal(
    path,
    "/api/admin/marketing/assets/b3a88242-2e91-4127-960f-43b047152aa9/image",
  );
});
