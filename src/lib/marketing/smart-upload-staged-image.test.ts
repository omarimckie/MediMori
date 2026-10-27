import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  issueSmartUploadIntent,
  issueSmartUploadPreviewDerivativeIntent,
  SMART_UPLOAD_INTENT_TTL_MS,
} from "./smart-upload-intent";
import {
  resolveSmartUploadStagedImage,
  setSmartUploadStagedImageBufferReaderForTests,
  SMART_UPLOAD_STAGED_IMAGE_CACHE_CONTROL,
  smartUploadStagedImageResponse,
} from "./smart-upload-staged-image";
const ORIGINAL_PATH = `marketing/public/${"a".repeat(32)}.png`;
const DERIVATIVE_PATH = `marketing/public/${"b".repeat(32)}.png`;

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "smart-upload-staged-image-secret";
});

afterEach(() => {
  setSmartUploadStagedImageBufferReaderForTests(null);
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

function issueOriginalIntent(username = "owner") {
  return issueSmartUploadIntent({ username, pathname: ORIGINAL_PATH }).uploadIntent;
}

function issueDerivativeIntent(username = "owner") {
  return issueSmartUploadPreviewDerivativeIntent({
    username,
    pathname: DERIVATIVE_PATH,
    originalPathname: ORIGINAL_PATH,
    finalizeKey: "fk-staged",
    strategy: "pad",
    targetRatio: "4:5",
  }).uploadIntent;
}

test("smart_upload intent serves staged image bytes", async () => {
  const uploadIntent = issueOriginalIntent();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  setSmartUploadStagedImageBufferReaderForTests(async () => bytes);
  const result = await resolveSmartUploadStagedImage(
    ORIGINAL_PATH,
    uploadIntent,
    "owner",
  );
  assert.equal(result.kind, "image");
  if (result.kind !== "image") return;
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.buffer, bytes);
  const response = smartUploadStagedImageResponse(result);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cache-Control"), SMART_UPLOAD_STAGED_IMAGE_CACHE_CONTROL);
});

test("smart_upload_preview_derivative intent serves staged image bytes", async () => {
  const uploadIntent = issueDerivativeIntent();
  setSmartUploadStagedImageBufferReaderForTests(async () => Buffer.from([0xff, 0xd8]));
  const result = await resolveSmartUploadStagedImage(
    DERIVATIVE_PATH,
    uploadIntent,
    "owner",
  );
  assert.equal(result.kind, "image");
});

test("rejects actor mismatch", async () => {
  const uploadIntent = issueOriginalIntent("owner");
  await assert.rejects(
    () => resolveSmartUploadStagedImage(ORIGINAL_PATH, uploadIntent, "intruder"),
    /match the current admin session/i,
  );
});

test("rejects pathname mismatch", async () => {
  const uploadIntent = issueOriginalIntent();
  await assert.rejects(
    () => resolveSmartUploadStagedImage(DERIVATIVE_PATH, uploadIntent, "owner"),
    /does not match upload intent/i,
  );
});

test("rejects expired intent", async () => {
  const uploadIntent = issueOriginalIntent();
  const originalNow = Date.now;
  Date.now = () => originalNow() + SMART_UPLOAD_INTENT_TTL_MS + 1_000;
  try {
    await assert.rejects(
      () => resolveSmartUploadStagedImage(ORIGINAL_PATH, uploadIntent, "owner"),
      /expired/i,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("rejects unsafe pathname", async () => {
  const uploadIntent = issueOriginalIntent();
  await assert.rejects(
    () =>
      resolveSmartUploadStagedImage(
        "marketing/private/deadbeefdeadbeefdeadbeefdeadbeef.pdf",
        uploadIntent,
        "owner",
      ),
    /Invalid smart upload pathname/i,
  );
});

test("rejects invalid intent signature", async () => {
  await assert.rejects(
    () => resolveSmartUploadStagedImage(ORIGINAL_PATH, "bad.intent", "owner"),
    /Invalid upload intent/i,
  );
});

test("missing blob returns not_found without leaking details", async () => {
  const uploadIntent = issueOriginalIntent();
  setSmartUploadStagedImageBufferReaderForTests(async () => {
    throw new Error("secret blob failure");
  });
  const result = await resolveSmartUploadStagedImage(
    ORIGINAL_PATH,
    uploadIntent,
    "owner",
  );
  assert.equal(result.kind, "not_found");
  const response = smartUploadStagedImageResponse(result);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.equal(body, JSON.stringify({ error: "Not found." }));
  assert.doesNotMatch(body, /secret/i);
});
