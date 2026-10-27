import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import * as resourcePreviewUrl from "./resource-preview-url";
import type { MarketingAsset, MarketingContent } from "./types";

const PREVIEW_PATH = `marketing/public/${"c".repeat(32)}.png`;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

afterEach(() => {
  resourcePreviewUrl.setResourcePreviewSignedGetUrlFactoryForTests(null);
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
});

test("resourcePreviewBlobPathnameFromAsset resolves pathname from stored blob URL", () => {
  const asset: MarketingAsset = {
    id: "a",
    name: "preview.png",
    type: "resource_preview",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: null,
    imageWidth: 1,
    imageHeight: 1,
    mimeType: "image/png",
    tags: [],
    url: `https://store-id.public.blob.vercel-storage.com/${PREVIEW_PATH}`,
    altText: "x",
    isDemo: false,
    createdAt: new Date().toISOString(),
  };
  assert.equal(resourcePreviewUrl.resourcePreviewBlobPathnameFromAsset(asset), PREVIEW_PATH);
});

test("createResourcePreviewSignedGetUrl rejects invalid preview pathnames", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  await assert.rejects(
    () => resourcePreviewUrl.createResourcePreviewSignedGetUrl("marketing/private/evil.pdf"),
    /Invalid resource preview pathname/,
  );
});

test("createResourcePreviewSignedGetUrl uses test factory when configured", async () => {
  const signedUrl = `https://store.private.blob.vercel-storage.com/${PREVIEW_PATH}?vercel-blob-signature=mock`;
  resourcePreviewUrl.setResourcePreviewSignedGetUrlFactoryForTests(async (pathname) => {
    assert.equal(pathname, PREVIEW_PATH);
    return signedUrl;
  });
  const url = await resourcePreviewUrl.createResourcePreviewSignedGetUrl(PREVIEW_PATH);
  assert.equal(url, signedUrl);
});

test("resolveFreeResourcePreviewUrlForContent returns signed URL for preview asset", async () => {
  const signedUrl = `https://store.private.blob.vercel-storage.com/${PREVIEW_PATH}?vercel-blob-signature=mock`;
  resourcePreviewUrl.setResourcePreviewSignedGetUrlFactoryForTests(async (pathname) => {
    assert.equal(pathname, PREVIEW_PATH);
    return signedUrl;
  });

  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-preview",
    name: "preview.png",
    type: "resource_preview",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "3:4",
    imageWidth: 900,
    imageHeight: 1200,
    mimeType: "image/png",
    tags: [],
    url: `https://legacy.public.blob.vercel-storage.com/${PREVIEW_PATH}`,
    altText: "preview",
    isDemo: false,
  });

  const content: MarketingContent = {
    id: "content-1",
    campaignId: "camp",
    weeklyPlanId: "plan",
    platform: "website",
    format: "free_resource",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "Resource",
    body: "Body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-preview"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createContent(content);

  const url = await resourcePreviewUrl.resolveFreeResourcePreviewUrlForContent(store, content);
  assert.equal(url, signedUrl);
});
