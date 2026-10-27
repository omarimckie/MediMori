import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import { setReadMarketingBlobBufferForTests } from "./marketing-blob";
import { MemoryMarketingStore } from "./memory-store";
import {
  assertAtLeastOneDestination,
  normalizeSmartUploadDestinations,
  parseSmartUploadDestinationsRecord,
} from "./smart-upload-destinations";
import {
  finalizeSmartUploadFromBlob,
  finalizeSmartUploadFromBuffer,
  validateSmartUploadImageBytes,
} from "./smart-upload";
import { targetRatioValue, transformSmartUploadImage } from "./smart-upload-fix";
import {
  issueSmartUploadIntent,
  issueSmartUploadPreviewDerivativeIntent,
} from "./smart-upload-intent";

const ORIGINAL_PATH = `marketing/public/${"d".repeat(32)}.png`;
const META_DERIV_PATH = `marketing/public/${"e".repeat(32)}.png`;
const PIN_DERIV_PATH = `marketing/public/${"f".repeat(32)}.png`;

function publicUrl(pathname: string): string {
  return `https://example.blob.vercel-storage.com/${pathname}`;
}

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "smart-upload-pinterest-integration-secret";
});

afterEach(() => {
  setReadMarketingBlobBufferForTests(null);
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 120, b: 180 } },
  })
    .png()
    .toBuffer();
}

test("destinations default to all platforms when omitted in API record", () => {
  const d = parseSmartUploadDestinationsRecord(undefined);
  assert.equal(d.facebook, true);
  assert.equal(d.instagram, true);
  assert.equal(d.pinterest, true);
});

test("assertAtLeastOneDestination rejects empty selection", () => {
  assert.throws(() =>
    assertAtLeastOneDestination({ facebook: false, instagram: false, pinterest: false }),
  );
});

test("buffer finalize rejects square image when all destinations including pinterest are selected", async () => {
  const store = new MemoryMarketingStore();
  const square = await png(1080, 1080);
  await assert.rejects(
    () =>
      finalizeSmartUploadFromBuffer(store, {
        caption: "Test",
        batchId: crypto.randomUUID(),
        finalizeKey: crypto.randomUUID(),
        actor: "tester",
        imageBuffer: square,
        imageFilename: "square.png",
        destinations: normalizeSmartUploadDestinations({
          facebook: true,
          instagram: true,
          pinterest: true,
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return /aspect ratio|validation/i.test(error.message);
    },
  );
});

test("meta-only backward compatibility uses meta validation scope by default", async () => {
  const square = await png(1080, 1080);
  const metaOnly = await validateSmartUploadImageBytes(square);
  assert.equal(metaOnly.ok, true);
  const all = await validateSmartUploadImageBytes(square, {
    facebook: true,
    instagram: true,
    pinterest: true,
  });
  assert.equal(all.ok, false);
});

test("vertical 2:3 image validates for pinterest and can be produced from square via transform", async () => {
  const square = await png(1200, 1200);
  const transformed = await transformSmartUploadImage({
    buffer: square,
    strategy: "pad",
    targetRatio: "2:3",
    destinations: { facebook: false, instagram: false, pinterest: true },
  });
  const pinCheck = await validateSmartUploadImageBytes(transformed.buffer, {
    facebook: false,
    instagram: false,
    pinterest: true,
  });
  assert.equal(pinCheck.ok, true);
});

test("finalize creates distinct tracking tokens and pinterest pin row", async () => {
  const store = new MemoryMarketingStore();
  const campaignId = crypto.randomUUID();
  await store.createCampaign({
    id: campaignId,
    name: "Pin campaign",
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
    bookIds: [],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: true,
  });

  const pinImage = await png(1000, 1500);
  const finalizeKey = crypto.randomUUID();
  const result = await finalizeSmartUploadFromBuffer(store, {
    caption: "",
    batchId: crypto.randomUUID(),
    finalizeKey,
    campaignId,
    destinations: normalizeSmartUploadDestinations({
      facebook: false,
      instagram: false,
      pinterest: true,
    }),
    pinterestTitle: "Sickle Cell story for families",
    pinterestDescription: "A gentle pin description without hashtags.",
    actor: "tester",
    imageBuffer: pinImage,
    imageFilename: "pin.png",
  });

  assert.ok(result.pinterestContentId);
  assert.equal(result.instagramContentId, null);
  assert.equal(result.facebookContentId, null);
  const pin = result.pinterest!;
  assert.equal(pin.platform, "pinterest");
  assert.equal(pin.format, "pin");
  assert.equal(pin.status, "needs_review");

  const replay = await finalizeSmartUploadFromBuffer(store, {
    caption: "",
    batchId: crypto.randomUUID(),
    finalizeKey,
    campaignId,
    destinations: normalizeSmartUploadDestinations({
      facebook: false,
      instagram: false,
      pinterest: true,
    }),
    pinterestTitle: "Sickle Cell story for families",
    pinterestDescription: "A gentle pin description without hashtags.",
    actor: "tester",
    imageBuffer: pinImage,
    imageFilename: "pin.png",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.pinterestContentId, result.pinterestContentId);
});

test("blob finalize with meta and pinterest derivatives creates three platform rows", async () => {
  const store = new MemoryMarketingStore();
  const square = await png(1080, 1080);
  const metaDerivative = await transformSmartUploadImage({
    buffer: square,
    strategy: "pad",
    targetRatio: "4:5",
    destinations: { facebook: true, instagram: true, pinterest: false },
  });
  const pinDerivative = await transformSmartUploadImage({
    buffer: square,
    strategy: "pad",
    targetRatio: "2:3",
    destinations: { facebook: false, instagram: false, pinterest: true },
  });

  const blobs = new Map<string, Buffer>([
    [ORIGINAL_PATH, square],
    [META_DERIV_PATH, metaDerivative.buffer],
    [PIN_DERIV_PATH, pinDerivative.buffer],
  ]);
  setReadMarketingBlobBufferForTests(async (pathname) => {
    const bytes = blobs.get(pathname);
    if (!bytes) throw new Error(`Unexpected blob pathname in test: ${pathname}`);
    return bytes;
  });

  const finalizeKey = "triple-platform-blob-key";
  const batchId = "triple-platform-batch";
  const { uploadIntent: originalIntent } = issueSmartUploadIntent({
    username: "owner",
    pathname: ORIGINAL_PATH,
  });
  const { uploadIntent: metaIntent } = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: META_DERIV_PATH,
    originalPathname: ORIGINAL_PATH,
    finalizeKey,
    strategy: "pad",
    targetRatio: "4:5",
  });
  const { uploadIntent: pinIntent } = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: PIN_DERIV_PATH,
    originalPathname: ORIGINAL_PATH,
    finalizeKey,
    strategy: "pad",
    targetRatio: "2:3",
  });

  const destinations = normalizeSmartUploadDestinations({
    facebook: true,
    instagram: true,
    pinterest: true,
  });

  const originalRef = {
    uploadIntent: originalIntent,
    pathname: ORIGINAL_PATH,
    publicUrl: publicUrl(ORIGINAL_PATH),
  };

  const first = await finalizeSmartUploadFromBlob(store, {
    caption: "Shared meta caption for triple finalize",
    batchId,
    finalizeKey,
    actor: "owner",
    destinations,
    pinterestTitle: "Family reading pin",
    pinterestDescription: "A gentle Pinterest description for the pin.",
    uploadIntent: metaIntent,
    pathname: META_DERIV_PATH,
    publicUrl: publicUrl(META_DERIV_PATH),
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: originalRef,
    },
    pinterestOutput: {
      uploadIntent: pinIntent,
      pathname: PIN_DERIV_PATH,
      publicUrl: publicUrl(PIN_DERIV_PATH),
      fix: {
        strategy: "pad",
        targetRatio: "2:3",
        original: originalRef,
      },
    },
  });

  const content = await store.listContent();
  const assets = await store.listAssets();
  const publications = await store.listPublications();

  assert.equal(content.length, 3);
  assert.equal(publications.length, 0);
  assert.equal(first.idempotentReplay, false);

  const ig = content.find((row) => row.platform === "instagram")!;
  const fb = content.find((row) => row.platform === "facebook")!;
  const pin = content.find((row) => row.platform === "pinterest")!;

  assert.equal(ig.status, "needs_review");
  assert.equal(fb.status, "needs_review");
  assert.equal(pin.status, "needs_review");
  assert.equal(pin.format, "pin");

  const finalizeKeys = new Set(
    content.map((row) => row.metadata?.smartUploadFinalizeKey).filter(Boolean),
  );
  assert.equal(finalizeKeys.size, 1);
  assert.equal(finalizeKeys.has(finalizeKey), true);

  const tokens = new Set(content.map((row) => row.trackingToken));
  assert.equal(tokens.size, 3);

  const metaAssetId = ig.assetIds[0]!;
  assert.equal(fb.assetIds[0], metaAssetId);
  const pinAssetId = pin.assetIds[0]!;
  assert.notEqual(metaAssetId, pinAssetId);

  const metaAsset = assets.find((a) => a.id === metaAssetId)!;
  const pinAsset = assets.find((a) => a.id === pinAssetId)!;
  assert.ok(
    Math.abs(metaAsset.imageWidth! / metaAsset.imageHeight! - targetRatioValue("4:5")) < 0.02,
  );
  assert.ok(
    Math.abs(pinAsset.imageWidth! / pinAsset.imageHeight! - targetRatioValue("2:3")) < 0.02,
  );

  const originalAssetId = ig.metadata?.originalAssetId;
  assert.ok(originalAssetId);
  const originalAsset = assets.find((a) => a.id === originalAssetId)!;
  assert.equal(originalAsset.imageWidth, 1080);
  assert.equal(originalAsset.imageHeight, 1080);

  const replay = await finalizeSmartUploadFromBlob(store, {
    caption: "Shared meta caption for triple finalize",
    batchId,
    finalizeKey,
    actor: "owner",
    destinations,
    pinterestTitle: "Family reading pin",
    pinterestDescription: "A gentle Pinterest description for the pin.",
    uploadIntent: metaIntent,
    pathname: META_DERIV_PATH,
    publicUrl: publicUrl(META_DERIV_PATH),
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: originalRef,
    },
    pinterestOutput: {
      uploadIntent: pinIntent,
      pathname: PIN_DERIV_PATH,
      publicUrl: publicUrl(PIN_DERIV_PATH),
      fix: {
        strategy: "pad",
        targetRatio: "2:3",
        original: originalRef,
      },
    },
  });

  assert.equal(replay.idempotentReplay, true);
  assert.equal((await store.listContent()).length, 3);

  const ordered = await store.listContent({ status: "needs_review" });
  const triple = ordered.filter(
    (row) => row.metadata?.smartUploadFinalizeKey === finalizeKey,
  );
  assert.equal(triple.length, 3);
  assert.deepEqual(
    triple.map((row) => row.platform),
    ["instagram", "facebook", "pinterest"],
  );
  assert.equal((await store.listAssets()).length, assets.length);
});
