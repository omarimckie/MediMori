import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, beforeEach, afterEach } from "node:test";
import { assertStagedManualResourceBlobRefs } from "./manual-upload";
import {
  issueResourceUploadIntent,
  parseResourceUploadIntent,
  verifyResourceUploadIntentForBlobToken,
  verifyResourceUploadIntentForCleanup,
  verifyResourceUploadIntentForRegistration,
} from "./resource-upload-intent";
import { resourceClientUploadTokenConstraints } from "./resource-client-upload";

const PREVIEW_PATH = `marketing/public/${"a".repeat(32)}.png`;
const FILE_PATH = `marketing/private/${"b".repeat(32)}.pdf`;
const VALID_PREVIEW_URL =
  "https://abc123.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "resource-upload-intent-test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

function issue(owner = "owner") {
  return issueResourceUploadIntent({
    username: owner,
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
  });
}

function clientPayload(role: "preview" | "file", uploadIntent: string) {
  return JSON.stringify({ role, uploadIntent });
}

test("blob token rejects pathname outside upload intent", () => {
  const { uploadIntent } = issue();
  const otherPreview = `marketing/public/${"e".repeat(32)}.png`;
  assert.throws(() =>
    verifyResourceUploadIntentForBlobToken(uploadIntent, "owner", otherPreview, "preview"),
  );
});

test("valid upload intent is accepted for registration and blob token", () => {
  const { uploadIntent } = issue();
  verifyResourceUploadIntentForRegistration(
    uploadIntent,
    "owner",
    PREVIEW_PATH,
    FILE_PATH,
  );
  verifyResourceUploadIntentForBlobToken(uploadIntent, "owner", PREVIEW_PATH, "preview");
  verifyResourceUploadIntentForBlobToken(uploadIntent, "owner", FILE_PATH, "file");
  resourceClientUploadTokenConstraints(PREVIEW_PATH, clientPayload("preview", uploadIntent), "owner");
});

test("invalid upload intent signature is rejected", () => {
  const { uploadIntent } = issue();
  const tampered = `${uploadIntent}x`;
  assert.throws(() => parseResourceUploadIntent(tampered));
  assert.throws(() =>
    verifyResourceUploadIntentForRegistration(tampered, "owner", PREVIEW_PATH, FILE_PATH),
  );
});

test("expired upload intent is rejected", () => {
  const payload = {
    v: 1 as const,
    username: "owner",
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
    iat: 1,
    exp: 2,
  };
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.ADMIN_SESSION_SECRET!)
    .update(segment)
    .digest("base64url");
  const expiredIntent = `${segment}.${signature}`;
  assert.throws(() => parseResourceUploadIntent(expiredIntent), /expired/i);
});

test("different admin is rejected", () => {
  const { uploadIntent } = issue("owner");
  assert.throws(() =>
    verifyResourceUploadIntentForRegistration(uploadIntent, "other-admin", PREVIEW_PATH, FILE_PATH),
  );
});

test("preview pathname mismatch is rejected", () => {
  const { uploadIntent } = issue();
  const otherPreview = `marketing/public/${"c".repeat(32)}.png`;
  assert.throws(() =>
    verifyResourceUploadIntentForRegistration(uploadIntent, "owner", otherPreview, FILE_PATH),
  );
});

test("private file pathname mismatch is rejected", () => {
  const { uploadIntent } = issue();
  const otherFile = `marketing/private/${"d".repeat(32)}.pdf`;
  assert.throws(() =>
    verifyResourceUploadIntentForRegistration(uploadIntent, "owner", PREVIEW_PATH, otherFile),
  );
});

test("cleanup authorization is bound to intent pathnames and admin", () => {
  const { uploadIntent } = issue("owner");
  const paths = verifyResourceUploadIntentForCleanup(uploadIntent, "owner");
  assert.equal(paths.previewPathname, PREVIEW_PATH);
  assert.equal(paths.filePathname, FILE_PATH);
  assert.throws(() => verifyResourceUploadIntentForCleanup(uploadIntent, "other-admin"));
});

test("staged blob refs still accept matching vercel preview URL", () => {
  assertStagedManualResourceBlobRefs({
    previewPathname: PREVIEW_PATH,
    previewPublicUrl: VALID_PREVIEW_URL,
    filePathname: FILE_PATH,
  });
});
