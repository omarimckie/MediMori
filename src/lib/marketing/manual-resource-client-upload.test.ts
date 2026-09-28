import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { marketingAuthError } from "./auth-guard";
import { assertStagedManualResourceBlobRefs, parseManualResourceStagedBlobBody } from "./manual-upload";
import {
  resourceClientUploadTokenConstraints,
  parseResourceClientUploadRole,
} from "./resource-client-upload";
import { issueResourceUploadIntent } from "./resource-upload-intent";

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

test("marketing admin auth guard rejects anonymous access", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
  assert.equal(marketingAuthError(true), null);
});

test("resource client upload payload requires role and upload intent", () => {
  assert.throws(() => parseResourceClientUploadRole(null));
  assert.throws(() => parseResourceClientUploadRole(JSON.stringify({ role: "other" })));
  assert.throws(() => parseResourceClientUploadRole(JSON.stringify({ role: "preview" })));
  const { uploadIntent } = issueResourceUploadIntent({
    username: "owner",
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
  });
  assert.equal(
    parseResourceClientUploadRole(JSON.stringify({ role: "preview", uploadIntent })),
    "preview",
  );
});

test("resource client upload token constraints reject invalid pathnames", () => {
  const { uploadIntent } = issueResourceUploadIntent({
    username: "owner",
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
  });
  const payload = (role: "preview" | "file") => JSON.stringify({ role, uploadIntent });
  assert.throws(() =>
    resourceClientUploadTokenConstraints(
      "marketing/public/evil.exe",
      payload("preview"),
      "owner",
    ),
  );
  assert.throws(() =>
    resourceClientUploadTokenConstraints("https://evil.com/x.pdf", payload("file"), "owner"),
  );
});

test("staged blob refs reject arbitrary external preview URLs", () => {
  assert.throws(() =>
    assertStagedManualResourceBlobRefs({
      previewPathname: PREVIEW_PATH,
      previewPublicUrl: "https://evil.example.com/not-our-blob.png",
      filePathname: FILE_PATH,
    }),
  );
});

test("parseManualResourceStagedBlobBody requires blob pathnames not arbitrary URLs", () => {
  assert.throws(() =>
    parseManualResourceStagedBlobBody({
      previewPathname: "",
      previewPublicUrl: "https://evil.example.com/x.png",
      filePathname: FILE_PATH,
    }),
  );
});

test("staged blob refs accept matching vercel blob preview URL", () => {
  assertStagedManualResourceBlobRefs({
    previewPathname: PREVIEW_PATH,
    previewPublicUrl: VALID_PREVIEW_URL,
    filePathname: FILE_PATH,
  });
});
