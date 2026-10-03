import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryMarketingStore } from "./memory-store";
import { resolveContentImageUrl } from "./assets";
import {
  marketingAssetPublicImageUrl,
  resolvePublishableMarketingAssetUrl,
} from "./marketing-asset-public-image-url";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import type { MarketingContent } from "./types";

const PHASE2_ASSET_ID = "239a03b0-2182-4a21-a997-052514c1cec4";
const BLOB_URL =
  "https://Q7Bbz4IQuVq0GO24.public.blob.vercel-storage.com/marketing/public/e9383e40db0141b2b4b8e5bdc44663c2.png";

const env = { NEXT_PUBLIC_SITE_URL: "https://twilight-feather.com" };

function blobAsset(id: string = PHASE2_ASSET_ID) {
  return {
    id,
    name: "x",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: "",
    aspectRatio: "1:1",
    imageWidth: 100,
    imageHeight: 100,
    mimeType: "image/png",
    tags: [],
    url: BLOB_URL,
    altText: "",
    isDemo: false,
    createdAt: "2026-10-02T21:01:01.194Z",
  };
}

test("marketingAssetPublicImageUrl uses canonical site origin", () => {
  const url = marketingAssetPublicImageUrl(PHASE2_ASSET_ID, env);
  assert.equal(url, `https://twilight-feather.com/api/marketing/assets/${PHASE2_ASSET_ID}/image`);
});

test("Phase 2 style blob URL resolves to canonical app URL when content approved", () => {
  const resolved = resolvePublishableMarketingAssetUrl(blobAsset(), "approved", env);
  assert.equal(
    resolved,
    `https://twilight-feather.com/api/marketing/assets/${PHASE2_ASSET_ID}/image`,
  );
});

test("blob-backed asset with needs_review content keeps raw blob URL for resolution", () => {
  const resolved = resolvePublishableMarketingAssetUrl(blobAsset(), "needs_review", env);
  assert.equal(resolved, BLOB_URL);
});

test("legitimate external public image URL is preserved", () => {
  const external = "https://cdn.example.com/promo.png";
  const resolved = resolvePublishableMarketingAssetUrl(
    {
      ...blobAsset("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
      source: "catalog",
      url: external,
    },
    "approved",
    env,
  );
  assert.equal(resolved, external);
});

test("resolveContentImageUrl returns canonical URL only when content is approved", async () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://twilight-feather.com";
  const store = new MemoryMarketingStore();
  await store.createAsset(blobAsset());
  const approvedContent: MarketingContent = {
    id: "c1",
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [PHASE2_ASSET_ID],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
    createdAt: "",
    updatedAt: "",
  };
  const url = await resolveContentImageUrl(store, approvedContent);
  assert.equal(url, marketingAssetPublicImageUrl(PHASE2_ASSET_ID));

  const needsReview = { ...approvedContent, status: "needs_review" as const };
  const raw = await resolveContentImageUrl(store, needsReview);
  assert.equal(raw, BLOB_URL);

  if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
});

test("protected non-image asset is not rewritten to proxy URL", () => {
  const resolved = resolvePublishableMarketingAssetUrl(
    {
      ...blobAsset("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
      mimeType: "application/pdf",
      url: "https://store.public.blob.vercel-storage.com/marketing/private/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf",
    },
    "approved",
    env,
  );
  assert.match(resolved, /marketing\/private/);
});
