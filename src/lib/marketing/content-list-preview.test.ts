import assert from "node:assert/strict";
import { test } from "node:test";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { buildContentListPreviewById } from "./content-list-preview";
import {
  isMarketingAssetPublicImageEligible,
} from "./marketing-asset-public-image";
import { MemoryMarketingStore } from "./memory-store";

const BLOB_URL =
  "https://example.test/marketing/public/cccccccccccccccccccccccccccccc.png";

test("content preview enrichment returns thumbnail for needs_review Smart Upload", async () => {
  const store = new MemoryMarketingStore();
  const assetId = crypto.randomUUID();
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
  const contentId = crypto.randomUUID();
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
  const asset = await store.getAsset(assetId);
  assert.ok(asset);
  assert.equal(await isMarketingAssetPublicImageEligible(store, asset), false);

  const rows = await store.listContent();
  const preview = await buildContentListPreviewById(store, rows);
  assert.ok(preview[contentId]?.previewUrl);
  assert.match(preview[contentId]!.previewUrl!, /^https?:\/\//);
});
