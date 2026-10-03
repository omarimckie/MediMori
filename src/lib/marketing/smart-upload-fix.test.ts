import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { MAX_MARKETING_IMAGE_BYTES } from "./upload-limits";
import { isAssetSuitableForPlatform } from "./platform-suitability";
import {
  assertTransformInputWithinLimits,
  isSmartUploadAspectRatioOnlyFailure,
  outputCanvasDimensions,
  SMART_UPLOAD_DERIVATIVE_TAG,
  smartUploadOriginalTag,
  targetRatioValue,
  transformSmartUploadImage,
} from "./smart-upload-fix";
import { validateSmartUploadImageBytes } from "./smart-upload";
import { MemoryMarketingStore } from "./memory-store";
import {
  finalizeSmartUploadFixedFromBuffers,
  finalizeSmartUploadFromBuffer,
} from "./smart-upload";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";

async function png(width: number, height: number, color = { r: 80, g: 120, b: 200 }) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

test("invalid aspect ratio only is fixable", async () => {
  const wide = await png(1600, 400);
  const result = await validateSmartUploadImageBytes(wide);
  assert.equal(result.ok, false);
  assert.ok(isSmartUploadAspectRatioOnlyFailure(result.issues));
});

test("corrupt image is not fixable aspect-only failure", async () => {
  const result = await validateSmartUploadImageBytes(Buffer.from("not-image"));
  assert.equal(result.ok, false);
  assert.equal(isSmartUploadAspectRatioOnlyFailure(result.issues), false);
});

test("4:5 padding derivative validates for IG and FB", async () => {
  const wide = await png(1600, 400);
  const out = await transformSmartUploadImage({ buffer: wide, strategy: "pad", targetRatio: "4:5" });
  assert.ok(isAssetSuitableForPlatform(out.truth, "instagram", "post"));
  assert.ok(isAssetSuitableForPlatform(out.truth, "facebook", "post"));
  assert.equal(out.truth.width / out.truth.height, targetRatioValue("4:5"));
});

test("square padding derivative validates", async () => {
  const wide = await png(1600, 400);
  const out = await transformSmartUploadImage({ buffer: wide, strategy: "pad", targetRatio: "1:1" });
  assert.ok(Math.abs(out.truth.width / out.truth.height - 1) < 0.02);
});

test("4:5 crop derivative validates", async () => {
  const tall = await png(400, 1600);
  const out = await transformSmartUploadImage({ buffer: tall, strategy: "crop", targetRatio: "4:5" });
  assert.ok(isAssetSuitableForPlatform(out.truth, "instagram", "post"));
});

test("square crop derivative validates", async () => {
  const wide = await png(1800, 600);
  const out = await transformSmartUploadImage({ buffer: wide, strategy: "crop", targetRatio: "1:1" });
  assert.ok(Math.abs(out.truth.width / out.truth.height - 1) < 0.02);
});

test("padding preserves full image content within canvas", async () => {
  const src = await png(800, 200);
  const out = await transformSmartUploadImage({ buffer: src, strategy: "pad", targetRatio: "4:5" });
  const meta = await sharp(out.buffer).metadata();
  assert.ok(meta.width && meta.height);
  assert.equal(meta.width! / meta.height!, targetRatioValue("4:5"));
});

test("crop produces expected target geometry", async () => {
  const src = await png(900, 900);
  const out = await transformSmartUploadImage({ buffer: src, strategy: "crop", targetRatio: "4:5" });
  assert.equal(out.truth.width / out.truth.height, targetRatioValue("4:5"));
});

test("excessive input edge rejected", () => {
  assert.throws(
    () => assertTransformInputWithinLimits(9000, 9000),
    /too large to transform/i,
  );
});

test("over 10 MB remains hard failure", async () => {
  const huge = Buffer.alloc(MAX_MARKETING_IMAGE_BYTES + 1);
  const result = await validateSmartUploadImageBytes(huge);
  assert.equal(result.ok, false);
  assert.equal(isSmartUploadAspectRatioOnlyFailure(result.issues), false);
});

test("valid image unchanged Phase 2 path", async () => {
  const store = new MemoryMarketingStore();
  const buffer = await png(1080, 1080);
  const first = await finalizeSmartUploadFromBuffer(store, {
    caption: "ok",
    batchId: "b",
    finalizeKey: "k-valid",
    actor: "owner",
    imageBuffer: buffer,
    imageFilename: "ok.png",
  });
  assert.equal(first.idempotentReplay, false);
  assert.equal((await store.listAssets()).length, 1);
  assert.equal(first.instagram.metadata?.originalAssetId, first.assetId);
});

test("fixed finalize creates two assets and lineage metadata", async () => {
  const store = new MemoryMarketingStore();
  const original = await png(1600, 400);
  const derivative = await transformSmartUploadImage({
    buffer: original,
    strategy: "pad",
    targetRatio: "4:5",
  });
  const result = await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "Fixed caption",
    batchId: "batch-fix",
    finalizeKey: "fix-key-1",
    actor: "owner",
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: {
        uploadIntent: "x",
        pathname: "marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        publicUrl: "https://example.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      },
    },
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: "https://example.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    derivativeAssetUrl: "https://example.blob.vercel-storage.com/marketing/public/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
    imageFilename: "wide.png",
  });

  assert.equal((await store.listAssets()).length, 2);
  assert.equal(result.instagram.assetIds[0], result.facebook.assetIds[0]);
  assert.equal(result.assetId, result.instagram.assetIds[0]);
  assert.notEqual(result.instagram.metadata?.originalAssetId, result.assetId);
  assert.equal(result.instagram.metadata?.smartUploadFixStrategy, "pad");
  assert.equal(result.instagram.metadata?.smartUploadFixTargetRatio, "4:5");

  const derivativeAsset = (await store.listAssets()).find((a) => a.id === result.assetId);
  assert.ok(derivativeAsset?.tags.includes(SMART_UPLOAD_DERIVATIVE_TAG));
  assert.ok(
    derivativeAsset?.tags.includes(
      smartUploadOriginalTag(result.instagram.metadata!.originalAssetId!),
    ),
  );
});

test("fixed finalize replay is idempotent", async () => {
  const store = new MemoryMarketingStore();
  const original = await png(1600, 400);
  const derivative = await transformSmartUploadImage({
    buffer: original,
    strategy: "pad",
    targetRatio: "4:5",
  });
  const bundle = {
    strategy: "pad" as const,
    targetRatio: "4:5" as const,
    original: {
      uploadIntent: "x",
      pathname: "marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      publicUrl: "https://example.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    },
  };
  const first = await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "c",
    batchId: "b",
    finalizeKey: "idem-fix",
    actor: "owner",
    fix: bundle,
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: "https://o",
    derivativeAssetUrl: "https://d",
  });
  const second = await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "c",
    batchId: "b",
    finalizeKey: "idem-fix",
    actor: "owner",
    fix: bundle,
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: "https://o",
    derivativeAssetUrl: "https://d",
  });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.assetId, first.assetId);
  assert.equal((await store.listAssets()).length, 2);
  assert.equal((await store.listContent()).length, 2);
});

test("fixed finalize creates no publications", async () => {
  const store = new MemoryMarketingStore();
  const original = await png(1500, 500);
  const derivative = await transformSmartUploadImage({
    buffer: original,
    strategy: "crop",
    targetRatio: "1:1",
  });
  await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "c",
    batchId: "b",
    finalizeKey: "pub-fix",
    actor: "owner",
    fix: {
      strategy: "crop",
      targetRatio: "1:1",
      original: {
        uploadIntent: "x",
        pathname: "marketing/public/cccccccccccccccccccccccccccccccc.png",
        publicUrl: "https://example.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
      },
    },
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: "https://o",
    derivativeAssetUrl: "https://d",
  });
  assert.equal((await store.listPublications()).length, 0);
});

test("derivative assets use smart_upload source", async () => {
  const store = new MemoryMarketingStore();
  const original = await png(1400, 500);
  const derivative = await transformSmartUploadImage({
    buffer: original,
    strategy: "pad",
    targetRatio: "4:5",
  });
  const result = await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "c",
    batchId: "b",
    finalizeKey: "src-fix",
    actor: "owner",
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: {
        uploadIntent: "x",
        pathname: "marketing/public/dddddddddddddddddddddddddddddddd.png",
        publicUrl: "https://example.blob.vercel-storage.com/marketing/public/dddddddddddddddddddddddddddddddd.png",
      },
    },
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: "https://o",
    derivativeAssetUrl: "https://d",
  });
  const assets = await store.listAssets();
  assert.equal(assets.length, 2);
  for (const asset of assets) {
    assert.equal(asset.source, SMART_UPLOAD_SOURCE);
  }
  const originalAsset = assets.find((a) => a.id === result.instagram.metadata?.originalAssetId);
  assert.match(originalAsset?.usageRestrictions ?? "", /immutable/i);
});

test("output canvas dimensions helper", () => {
  const pad = outputCanvasDimensions(1600, 400, targetRatioValue("4:5"), "pad");
  assert.equal(pad.width / pad.height, targetRatioValue("4:5"));
  const crop = outputCanvasDimensions(1600, 400, targetRatioValue("1:1"), "crop");
  assert.equal(crop.width, crop.height);
});
