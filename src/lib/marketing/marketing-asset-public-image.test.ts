import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT_STATUSES, type ContentStatus, type MarketingAsset } from "./types";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { SMART_UPLOAD_DERIVATIVE_TAG } from "./smart-upload-fix";
import { MemoryMarketingStore } from "./memory-store";
import {
  MARKETING_ASSET_PUBLIC_IMAGE_CACHE_CONTROL,
  getMarketingAssetPublicImageBufferReadCountForTests,
  isContentStatusEligibleForPublicMarketingAssetProxy,
  isMarketingAssetPublicImageEligible,
  marketingAssetPublicImageResponse,
  marketingPublicImagePathnameFromAsset,
  parseMarketingAssetPublicImageId,
  resolveMarketingAssetPublicImage,
  setMarketingAssetPublicImageBufferReaderForTests,
} from "./marketing-asset-public-image";

const BLOB_URL =
  "https://Q7Bbz4IQuVq0GO24.public.blob.vercel-storage.com/marketing/public/e9383e40db0141b2b4b8e5bdc44663c2.png";
const PATH = "marketing/public/e9383e40db0141b2b4b8e5bdc44663c2.png";
const ASSET_ID = "239a03b0-2182-4a21-a997-052514c1cec4";

function baseAsset(overrides: Partial<MarketingAsset> = {}): MarketingAsset {
  return {
    id: ASSET_ID,
    name: "test.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: "Smart Upload",
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: ["smart_upload"],
    url: BLOB_URL,
    altText: "alt",
    isDemo: false,
    createdAt: "2026-10-02T21:01:01.194Z",
    ...overrides,
  };
}

async function seedContent(
  store: MemoryMarketingStore,
  assetId: string,
  status: ContentStatus,
  contentId = crypto.randomUUID(),
) {
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status,
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
    trackingToken: `tok-${contentId.slice(0, 8)}`,
    originalBody: null,
    bookId: null,
    metadata: { source: "smart_upload", smartUploadFinalizeKey: `fk-${contentId}` },
    isDemo: false,
  });
}

test("content status allowlist matches expected publishable set", () => {
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("approved"), true);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("scheduled"), true);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("published"), true);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("failed"), true);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("needs_review"), false);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("rejected"), false);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("draft"), false);
  assert.equal(isContentStatusEligibleForPublicMarketingAssetProxy("archived"), false);
});

for (const status of CONTENT_STATUSES) {
  const expected = ["approved", "scheduled", "published", "failed"].includes(status);
  test(`status matrix: ${status} -> ${expected}`, async () => {
    const store = new MemoryMarketingStore();
    const asset = baseAsset({ id: crypto.randomUUID() });
    await store.createAsset(asset);
    await seedContent(store, asset.id, status);
    assert.equal(await isMarketingAssetPublicImageEligible(store, asset), expected);
  });
}

test("one rejected and one approved reference makes asset eligible", async () => {
  const store = new MemoryMarketingStore();
  const asset = baseAsset();
  await store.createAsset(asset);
  await seedContent(store, asset.id, "rejected", "rejected-row");
  await seedContent(store, asset.id, "approved", "approved-row");
  assert.equal(await isMarketingAssetPublicImageEligible(store, asset), true);
});

test("needs_review plus rejected reference is not eligible", async () => {
  const store = new MemoryMarketingStore();
  const asset = baseAsset();
  await store.createAsset(asset);
  await seedContent(store, asset.id, "needs_review", "nr");
  await seedContent(store, asset.id, "rejected", "rej");
  assert.equal(await isMarketingAssetPublicImageEligible(store, asset), false);
});

test("no content references -> not eligible", async () => {
  const store = new MemoryMarketingStore();
  await store.createAsset(baseAsset());
  assert.equal(await isMarketingAssetPublicImageEligible(store, baseAsset()), false);
});

test("fixed-upload original with derivative on content only is not eligible", async () => {
  const store = new MemoryMarketingStore();
  const originalId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const derivativeId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await store.createAsset(
    baseAsset({
      id: originalId,
      url: "https://store.public.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
      tags: ["smart_upload"],
    }),
  );
  await store.createAsset(
    baseAsset({
      id: derivativeId,
      url: "https://store.public.blob.vercel-storage.com/marketing/public/dddddddddddddddddddddddddddddddd.png",
      tags: ["smart_upload", SMART_UPLOAD_DERIVATIVE_TAG],
    }),
  );
  await seedContent(store, derivativeId, "approved");
  const original = await store.getAsset(originalId);
  const derivative = await store.getAsset(derivativeId);
  assert.ok(original && derivative);
  assert.equal(await isMarketingAssetPublicImageEligible(store, original), false);
  assert.equal(await isMarketingAssetPublicImageEligible(store, derivative), true);
});

test("parseMarketingAssetPublicImageId accepts UUID and rejects malformed", () => {
  assert.equal(parseMarketingAssetPublicImageId(ASSET_ID), ASSET_ID);
  assert.equal(parseMarketingAssetPublicImageId("not-a-uuid"), null);
});

test("marketingPublicImagePathnameFromAsset resolves marketing/public only", () => {
  assert.equal(marketingPublicImagePathnameFromAsset(baseAsset()), PATH);
  assert.equal(
    marketingPublicImagePathnameFromAsset(
      baseAsset({
        url: "https://x.public.blob.vercel-storage.com/marketing/private/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf",
      }),
    ),
    null,
  );
});

test("valid approved-linked marketing image serves bytes on GET", async () => {
  const store = new MemoryMarketingStore();
  const asset = baseAsset();
  await store.createAsset(asset);
  await seedContent(store, asset.id, "approved");
  setMarketingAssetPublicImageBufferReaderForTests(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const result = await resolveMarketingAssetPublicImage(store, asset.id, { includeBody: true });
  assert.equal(result.kind, "image");
  setMarketingAssetPublicImageBufferReaderForTests(null);
});

test("needs_review linked asset is not eligible on GET", async () => {
  const store = new MemoryMarketingStore();
  const asset = baseAsset();
  await store.createAsset(asset);
  await seedContent(store, asset.id, "needs_review");
  setMarketingAssetPublicImageBufferReaderForTests(async () => {
    throw new Error("should not read");
  });
  const result = await resolveMarketingAssetPublicImage(store, asset.id, { includeBody: true });
  assert.equal(result.kind, "not_found");
  assert.equal(getMarketingAssetPublicImageBufferReadCountForTests(), 0);
  setMarketingAssetPublicImageBufferReaderForTests(null);
});

test("HEAD does not invoke full Blob-buffer reader", async () => {
  const store = new MemoryMarketingStore();
  const asset = baseAsset();
  await store.createAsset(asset);
  await seedContent(store, asset.id, "approved");
  setMarketingAssetPublicImageBufferReaderForTests(async () => {
    throw new Error("HEAD must not read blob");
  });
  const result = await resolveMarketingAssetPublicImage(store, asset.id, { includeBody: false });
  assert.equal(result.kind, "headers_only");
  assert.equal(getMarketingAssetPublicImageBufferReadCountForTests(), 0);
  const response = marketingAssetPublicImageResponse(result, "HEAD");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cache-Control"), MARKETING_ASSET_PUBLIC_IMAGE_CACHE_CONTROL);
  setMarketingAssetPublicImageBufferReaderForTests(null);
});

test("missing underlying Blob returns generic 404 without internal details", async () => {
  const store = new MemoryMarketingStore();
  const asset = baseAsset();
  await store.createAsset(asset);
  await seedContent(store, asset.id, "approved");
  setMarketingAssetPublicImageBufferReaderForTests(async () => {
    throw new Error("Vercel Blob internal secret failure");
  });
  const result = await resolveMarketingAssetPublicImage(store, asset.id, { includeBody: true });
  assert.equal(result.kind, "not_found");
  const response = marketingAssetPublicImageResponse(result, "GET");
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.equal(body, JSON.stringify({ error: "Not found." }));
  assert.doesNotMatch(body, /secret/i);
  setMarketingAssetPublicImageBufferReaderForTests(null);
});

test("successful GET includes nosniff and conservative cache policy", async () => {
  const result = marketingAssetPublicImageResponse(
    { kind: "image", buffer: Buffer.from([0x89]), mimeType: "image/png" },
    "GET",
  );
  assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(result.headers.get("Cache-Control"), MARKETING_ASSET_PUBLIC_IMAGE_CACHE_CONTROL);
  assert.doesNotMatch(result.headers.get("Cache-Control") ?? "", /immutable/);
  assert.doesNotMatch(result.headers.get("Cache-Control") ?? "", /31536000/);
});
