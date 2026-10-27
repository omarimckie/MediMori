import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  issueSmartUploadIntent,
  issueSmartUploadPreviewDerivativeIntent,
} from "./smart-upload-intent";
import {
  prepareSmartUploadModelImageInput,
  readSmartUploadCaptionImageBuffer,
  setSmartUploadCaptionBufferReaderForTests,
  setSmartUploadCaptionDimensionsProbeForTests,
  SMART_UPLOAD_MODEL_IMAGE_MAX_BYTES,
} from "./smart-upload-caption-image";

const ORIGINAL_PATH = `marketing/public/${"a".repeat(32)}.png`;
const DERIVATIVE_PATH = `marketing/public/${"b".repeat(32)}.png`;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "caption-image-test-secret";
  setSmartUploadCaptionBufferReaderForTests(async (pathname) => {
    if (pathname === ORIGINAL_PATH || pathname === DERIVATIVE_PATH) return TINY_PNG;
    throw new Error("missing");
  });
});

afterEach(() => {
  setSmartUploadCaptionBufferReaderForTests(null);
  setSmartUploadCaptionDimensionsProbeForTests(null);
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

test("readSmartUploadCaptionImageBuffer verifies intent for original", async () => {
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const buffer = await readSmartUploadCaptionImageBuffer(ORIGINAL_PATH, uploadIntent, "owner");
  assert.ok(buffer.length > 0);
});

test("readSmartUploadCaptionImageBuffer rejects actor mismatch", async () => {
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  await assert.rejects(
    () => readSmartUploadCaptionImageBuffer(ORIGINAL_PATH, uploadIntent, "intruder"),
    /match the current admin session/i,
  );
});

test("derivative intent path reads bytes", async () => {
  const uploadIntent = issueSmartUploadPreviewDerivativeIntent({
    username: "owner",
    pathname: DERIVATIVE_PATH,
    originalPathname: ORIGINAL_PATH,
    finalizeKey: "fk",
    strategy: "pad",
    targetRatio: "4:5",
  }).uploadIntent;
  const buffer = await readSmartUploadCaptionImageBuffer(DERIVATIVE_PATH, uploadIntent, "owner");
  assert.ok(buffer.length > 0);
});

test("prepareSmartUploadModelImageInput bounds encoded bytes", async () => {
  const prepared = await prepareSmartUploadModelImageInput(TINY_PNG);
  assert.ok(prepared.encodedByteLength <= SMART_UPLOAD_MODEL_IMAGE_MAX_BYTES);
  assert.match(prepared.mimeType, /^image\//);
  assert.ok(prepared.base64.length > 0);
});

test("prepareSmartUploadModelImageInput rejects over pixel limit before transform", async () => {
  setSmartUploadCaptionDimensionsProbeForTests(async () => ({
    width: 9000,
    height: 9000,
    mimeType: "image/png",
  }));
  await assert.rejects(() => prepareSmartUploadModelImageInput(TINY_PNG), /too large|too many pixels/i);
});
