import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import { MemoryMarketingStore } from "./memory-store";
import {
  assertDistinctSmartUploadOriginalAndDerivativePathnames,
  discardSmartUploadPreviewDerivative,
  finalizeSmartUploadFixedFromBuffers,
  finalizeSmartUploadFromBlob,
} from "./smart-upload";
import {
  issueSmartUploadIntent,
  issueSmartUploadPreviewDerivativeIntent,
  parseSmartUploadPreviewDerivativeIntent,
  SMART_UPLOAD_INTENT_TTL_MS,
  verifySmartUploadPreviewDerivativeIntentForFinalize,
  verifySmartUploadPreviewDerivativeIntentForPathname,
} from "./smart-upload-intent";
import { assertTransformInputWithinLimits } from "./smart-upload-fix";
import { transformSmartUploadImage } from "./smart-upload-fix";
const ORIGINAL_PATH = `marketing/public/${"a".repeat(32)}.png`;
const DERIVATIVE_PATH = `marketing/public/${"b".repeat(32)}.png`;
const OTHER_ORIGINAL_PATH = `marketing/public/${"c".repeat(32)}.png`;

function publicUrl(pathname: string): string {
  return `https://example.blob.vercel-storage.com/${pathname}`;
}

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "smart-upload-hardening-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

function issueDerivativeBundle(input: {
  finalizeKey: string;
  strategy?: "pad" | "crop";
  targetRatio?: "4:5" | "1:1";
  originalPathname?: string;
  derivativePathname?: string;
}) {
  const originalPathname = input.originalPathname ?? ORIGINAL_PATH;
  const derivativePathname = input.derivativePathname ?? DERIVATIVE_PATH;
  const { uploadIntent } = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: derivativePathname,
    originalPathname,
    finalizeKey: input.finalizeKey,
    strategy: input.strategy ?? "pad",
    targetRatio: input.targetRatio ?? "4:5",
  });
  return { uploadIntent, originalPathname, derivativePathname };
}

async function widePng() {
  return sharp({
    create: { width: 1600, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

test("discard-preview rejects original upload intent and does not delete blob", async () => {
  const { uploadIntent } = issueSmartUploadIntent({
    username: "owner",
    pathname: ORIGINAL_PATH,
  });
  const preview = {
    uploadIntent,
    pathname: ORIGINAL_PATH,
    publicUrl: publicUrl(ORIGINAL_PATH),
  };
  await assert.rejects(
    () => discardSmartUploadPreviewDerivative({ actor: "owner", preview }),
    /preview derivative/i,
  );

  let deleteReached = false;
  await assert.rejects(async () => {
    verifySmartUploadPreviewDerivativeIntentForPathname(
      preview.uploadIntent,
      "owner",
      preview.pathname,
    );
    deleteReached = true;
  }, /preview derivative/i);
  assert.equal(deleteReached, false);
});

test("valid derivative preview intent passes discard authorization", () => {
  const { uploadIntent, derivativePathname } = issueDerivativeBundle({ finalizeKey: "fk-discard" });
  verifySmartUploadPreviewDerivativeIntentForPathname(
    uploadIntent,
    "owner",
    derivativePathname,
  );
});

test("derivative intent is bound to derivative pathname", () => {
  const { uploadIntent, derivativePathname } = issueDerivativeBundle({ finalizeKey: "fk-path" });
  verifySmartUploadPreviewDerivativeIntentForPathname(
    uploadIntent,
    "owner",
    derivativePathname,
  );
  assert.throws(
    () =>
      verifySmartUploadPreviewDerivativeIntentForPathname(
        uploadIntent,
        "owner",
        OTHER_ORIGINAL_PATH,
      ),
    /pathname does not match/i,
  );
});

test("derivative intent is bound to original pathname and finalizeKey", () => {
  const finalizeKey = "fk-bind";
  const { uploadIntent, originalPathname, derivativePathname } = issueDerivativeBundle({
    finalizeKey,
  });
  verifySmartUploadPreviewDerivativeIntentForFinalize(uploadIntent, "owner", {
    derivativePathname,
    originalPathname,
    finalizeKey,
    strategy: "pad",
    targetRatio: "4:5",
  });
  assert.throws(
    () =>
      verifySmartUploadPreviewDerivativeIntentForFinalize(uploadIntent, "owner", {
        derivativePathname,
        originalPathname: OTHER_ORIGINAL_PATH,
        finalizeKey,
        strategy: "pad",
        targetRatio: "4:5",
      }),
    /original pathname/i,
  );
  assert.throws(
    () =>
      verifySmartUploadPreviewDerivativeIntentForFinalize(uploadIntent, "owner", {
        derivativePathname,
        originalPathname,
        finalizeKey: "other-key",
        strategy: "pad",
        targetRatio: "4:5",
      }),
    /finalizeKey/i,
  );
});

test("cross-upload derivative substitution is rejected at finalize verify", () => {
  const { uploadIntent, derivativePathname } = issueDerivativeBundle({
    finalizeKey: "fk-a",
    originalPathname: ORIGINAL_PATH,
  });
  assert.throws(
    () =>
      verifySmartUploadPreviewDerivativeIntentForFinalize(uploadIntent, "owner", {
        derivativePathname,
        originalPathname: OTHER_ORIGINAL_PATH,
        finalizeKey: "fk-b",
        strategy: "pad",
        targetRatio: "4:5",
      }),
    /original pathname|finalizeKey/i,
  );
});

test("same original and derivative pathname rejected before persistence", () => {
  assert.throws(
    () => assertDistinctSmartUploadOriginalAndDerivativePathnames(ORIGINAL_PATH, ORIGINAL_PATH),
    /must differ/i,
  );
  assert.throws(
    () =>
      issueSmartUploadPreviewDerivativeIntent({
        username: "owner",
        pathname: ORIGINAL_PATH,
        originalPathname: ORIGINAL_PATH,
        finalizeKey: "fk-same",
        strategy: "pad",
        targetRatio: "4:5",
      }),
    /must differ/i,
  );
});

test("complete fixed finalize replay returns before derivative intent validation", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "fk-replay-expired";
  const original = await widePng();
  const derivative = await transformSmartUploadImage({
    buffer: original,
    strategy: "pad",
    targetRatio: "4:5",
  });
  const { uploadIntent: derivativeIntent, originalPathname, derivativePathname } =
    issueDerivativeBundle({ finalizeKey });
  const { uploadIntent: originalIntent } = issueSmartUploadIntent({
    username: "owner",
    pathname: originalPathname,
  });

  const first = await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "caption",
    batchId: "batch",
    finalizeKey,
    actor: "owner",
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: {
        uploadIntent: originalIntent,
        pathname: originalPathname,
        publicUrl: publicUrl(originalPathname),
      },
    },
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: publicUrl(originalPathname),
    derivativeAssetUrl: publicUrl(derivativePathname),
  });
  assert.equal(first.idempotentReplay, false);

  const expiredDerivativeIntent = derivativeIntent;
  const payloadSegment = expiredDerivativeIntent.split(".")[0]!;
  const raw = Buffer.from(payloadSegment, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as { exp: number };
  parsed.exp = Date.now() - 1000;
  const tamperedSegment = Buffer.from(JSON.stringify(parsed)).toString("base64url");
  const tamperedIntent = `${tamperedSegment}.${expiredDerivativeIntent.split(".")[1]}`;

  const replay = await finalizeSmartUploadFromBlob(store, {
    caption: "caption",
    batchId: "batch",
    finalizeKey,
    actor: "owner",
    uploadIntent: tamperedIntent,
    pathname: derivativePathname,
    publicUrl: publicUrl(derivativePathname),
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: {
        uploadIntent: "totally.invalid",
        pathname: originalPathname,
        publicUrl: publicUrl(originalPathname),
      },
    },
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.assetId, first.assetId);
  assert.equal(replay.instagramContentId, first.instagramContentId);
  assert.equal(replay.facebookContentId, first.facebookContentId);
  assert.equal((await store.listAssets()).length, 2);
  assert.equal((await store.listContent()).length, 2);
});

test("failed fixed finalize validation leaves store empty for retry", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "fk-retry";
  const original = await widePng();
  const badDerivative = Buffer.from("not-a-valid-image");
  const { originalPathname, derivativePathname } = issueDerivativeBundle({ finalizeKey });
  const { uploadIntent: originalIntent } = issueSmartUploadIntent({
    username: "owner",
    pathname: originalPathname,
  });

  await assert.rejects(() =>
    finalizeSmartUploadFixedFromBuffers(store, {
      caption: "caption",
      batchId: "batch",
      finalizeKey,
      actor: "owner",
      fix: {
        strategy: "pad",
        targetRatio: "4:5",
        original: {
          uploadIntent: originalIntent,
          pathname: originalPathname,
          publicUrl: publicUrl(originalPathname),
        },
      },
      originalBuffer: original,
      derivativeBuffer: badDerivative,
      originalAssetUrl: publicUrl(originalPathname),
      derivativeAssetUrl: publicUrl(derivativePathname),
    }),
  );
  assert.equal((await store.listAssets()).length, 0);

  const derivative = await transformSmartUploadImage({
    buffer: original,
    strategy: "pad",
    targetRatio: "4:5",
  });
  const second = await finalizeSmartUploadFixedFromBuffers(store, {
    caption: "caption",
    batchId: "batch",
    finalizeKey,
    actor: "owner",
    fix: {
      strategy: "pad",
      targetRatio: "4:5",
      original: {
        uploadIntent: originalIntent,
        pathname: originalPathname,
        publicUrl: publicUrl(originalPathname),
      },
    },
    originalBuffer: original,
    derivativeBuffer: derivative.buffer,
    originalAssetUrl: publicUrl(originalPathname),
    derivativeAssetUrl: publicUrl(derivativePathname),
  });
  assert.equal(second.idempotentReplay, false);
  assert.equal((await store.listAssets()).length, 2);
});

test("expired derivative intent is rejected when finalize is not complete", () => {
  const fixedNow = 1_700_000_000_000;
  const realDateNow = Date.now;
  Date.now = () => fixedNow;
  const { uploadIntent } = issueDerivativeBundle({ finalizeKey: "fk-exp" });
  Date.now = () => fixedNow + SMART_UPLOAD_INTENT_TTL_MS + 60_000;
  assert.throws(() => parseSmartUploadPreviewDerivativeIntent(uploadIntent), /expired/i);
  Date.now = realDateNow;
});

test("transform input pixel limits accept representative sizes under 32 MP", () => {
  assertTransformInputWithinLimits(4032, 3024);
  assertTransformInputWithinLimits(5000, 4000);
  assertTransformInputWithinLimits(6000, 4000);
});

test("transform input pixel limits reject over 32 MP", () => {
  assert.throws(() => assertTransformInputWithinLimits(8064, 6048), /too many pixels/i);
  assert.throws(() => assertTransformInputWithinLimits(8192, 4096), /too many pixels/i);
});
