import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { approveContent, publishDue, scheduleApproved } from "./approval";
import { formatAspectRatioLabel } from "./asset-truth";
import { marketingAuthError } from "./auth-guard";
import { resolveContentImageUrl, toAbsoluteAssetUrl } from "./assets";
import {
  MarketingAssetUpdateError,
  replaceMarketingAssetFile,
  updateMarketingAssetMetadata,
} from "./asset-update";
import { createManualSocialPost } from "./manual-upload";
import { tryResolveMarketingBlobPathnameFromUrl } from "./marketing-blob";
import { MemoryMarketingStore } from "./memory-store";

async function pngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 180, b: 240 },
    },
  })
    .png()
    .toBuffer();
}

async function webpBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  })
    .webp()
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

async function manualInstagramAsset(store: MemoryMarketingStore) {
  const { planId, campaignId } = await planContext(store);
  const buffer = await pngBuffer(1080, 1350);
  const { content, assets } = await createManualSocialPost(store, {
    platform: "instagram",
    placement: "feed",
    body: "Caption",
    weeklyPlanId: planId,
    campaignId,
    actor: "tester",
    imageBuffer: buffer,
    imageFilename: "first.png",
  });
  return { content, asset: assets[0] };
}

test("replacement succeeds when old blob cleanup throws and new blob is kept", async () => {
  const store = new MemoryMarketingStore();
  const { asset } = await manualInstagramAsset(store);
  const originalUrl = asset.url;
  assert.ok(originalUrl?.startsWith("/marketing-uploads/"));

  const envKey = "MARKETING_ASSET_UPDATE_TEST_SIMULATE_OLD_BLOB_CLEANUP_THROW";
  const previous = process.env[envKey];
  process.env[envKey] = "1";
  try {
    const replacement = await webpBuffer(800, 1000);
    const updated = await replaceMarketingAssetFile(store, asset.id, replacement, "kept.webp");

    assert.equal(updated.id, asset.id);
    assert.notEqual(updated.url, originalUrl);
    assert.ok(updated.url?.startsWith("/marketing-uploads/"));

    const persisted = await store.getAsset(asset.id);
    assert.equal(persisted?.url, updated.url);

    const newBlobPathname = tryResolveMarketingBlobPathnameFromUrl(updated.url);
    assert.ok(newBlobPathname);
    const newFileName = newBlobPathname.replace("local-public/", "");
    await readFile(path.join(process.cwd(), "public", "marketing-uploads", newFileName));
  } finally {
    if (previous === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previous;
    }
  }
});

test("metadata update keeps the same asset id", async () => {
  const store = new MemoryMarketingStore();
  const { asset } = await manualInstagramAsset(store);
  const updated = await updateMarketingAssetMetadata(store, asset.id, {
    name: "Renamed upload",
    altText: "New alt",
    approved: true,
    tags: ["manual_upload", "instagram"],
  });
  assert.equal(updated.id, asset.id);
  assert.equal(updated.name, "Renamed upload");
  assert.equal(updated.altText, "New alt");
});

test("manual asset replacement updates url dimensions mime and aspect ratio", async () => {
  const store = new MemoryMarketingStore();
  const { asset } = await manualInstagramAsset(store);
  const originalUrl = asset.url;
  const replacement = await webpBuffer(1200, 1500);
  const updated = await replaceMarketingAssetFile(store, asset.id, replacement, "tall.webp");
  assert.equal(updated.id, asset.id);
  assert.notEqual(updated.url, originalUrl);
  assert.equal(updated.imageWidth, 1200);
  assert.equal(updated.imageHeight, 1500);
  assert.equal(updated.mimeType, "image/webp");
  assert.equal(updated.aspectRatio, formatAspectRatioLabel(1200, 1500));
});

test("catalog asset replacement is rejected and url unchanged", async () => {
  const store = new MemoryMarketingStore();
  const id = crypto.randomUUID();
  const url = "https://twilight-feather.com/covers/example.png";
  await store.createAsset({
    id,
    name: "Catalog cover",
    type: "cover",
    source: "catalog",
    bookId: "book-one",
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "4:5",
    imageWidth: 800,
    imageHeight: 1000,
    mimeType: "image/png",
    tags: ["cover"],
    url,
    altText: "Cover",
    isDemo: false,
  });
  const buffer = await pngBuffer(1080, 1350);
  await assert.rejects(
    () => replaceMarketingAssetFile(store, id, buffer, "hack.png"),
    (error: unknown) => {
      assert.ok(error instanceof MarketingAssetUpdateError);
      assert.equal(error.status, 403);
      return true;
    },
  );
  const unchanged = await store.getAsset(id);
  assert.equal(unchanged?.url, url);
});

test("content still references same asset id and resolves new url after replacement", async () => {
  const store = new MemoryMarketingStore();
  const { content, asset } = await manualInstagramAsset(store);
  const beforeIds = [...content.assetIds];
  const replacement = await webpBuffer(1080, 1350);
  await replaceMarketingAssetFile(store, asset.id, replacement, "swap.webp");
  const refreshedContent = await store.getContent(content.id);
  assert.deepEqual(refreshedContent?.assetIds, beforeIds);
  const refreshedAsset = await store.getAsset(asset.id);
  const resolved = await resolveContentImageUrl(store, refreshedContent!);
  assert.equal(resolved, toAbsoluteAssetUrl(refreshedAsset!.url!.trim()));
});

test("published publication is unchanged after asset replacement", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const { content, asset } = await manualInstagramAsset(store);
  await approveContent(store, content.id, "owner");
  await scheduleApproved(store, content.id);
  const results = await publishDue(store);
  assert.ok(results.length >= 1);
  const publication = (await store.listPublications()).find((row) => row.contentId === content.id);
  assert.ok(publication);
  assert.equal(publication!.status, "published");
  const externalId = publication!.externalId;
  const publicationUrl = publication!.url;

  await replaceMarketingAssetFile(store, asset.id, await pngBuffer(900, 1200), "after-publish.png");

  const after = (await store.listPublications()).find((row) => row.id === publication!.id);
  assert.equal(after?.status, "published");
  assert.equal(after?.externalId, externalId);
  assert.equal(after?.url, publicationUrl);
});

test("unauthenticated marketing admin guard rejects asset operations", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
  assert.equal(marketingAuthError(true), null);
});

test("invalid image replacement is rejected without partial metadata update", async () => {
  const store = new MemoryMarketingStore();
  const { asset } = await manualInstagramAsset(store);
  const before = await store.getAsset(asset.id);
  await assert.rejects(() =>
    replaceMarketingAssetFile(store, asset.id, Buffer.from("not-an-image"), "bad.bin"),
  );
  const after = await store.getAsset(asset.id);
  assert.equal(after?.url, before?.url);
  assert.equal(after?.imageWidth, before?.imageWidth);
  assert.equal(after?.imageHeight, before?.imageHeight);
  assert.equal(after?.mimeType, before?.mimeType);
});

test("tryResolveMarketingBlobPathnameFromUrl only accepts known patterns", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl("/marketing-uploads/abc.png"),
    "local-public/abc.png",
  );
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(
      "https://abc.public.blob.vercel-storage.com/marketing/public/xyz.png",
    ),
    "marketing/public/xyz.png",
  );
  assert.equal(tryResolveMarketingBlobPathnameFromUrl("https://cdn.example.com/foo.png"), null);
});

test("manual upload source is required for metadata patch", async () => {
  const store = new MemoryMarketingStore();
  const id = crypto.randomUUID();
  await store.createAsset({
    id,
    name: "Other",
    type: "upload",
    source: "generated",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: null,
    imageWidth: 100,
    imageHeight: 100,
    mimeType: "image/png",
    tags: [],
    url: "/marketing-uploads/x.png",
    altText: null,
    isDemo: false,
  });
  await assert.rejects(
    () => updateMarketingAssetMetadata(store, id, { name: "Nope" }),
    (error: unknown) => {
      assert.ok(error instanceof MarketingAssetUpdateError);
      assert.equal(error.status, 403);
      return true;
    },
  );
});
