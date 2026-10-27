import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { marketingAuthError } from "./auth-guard";
import { issueResourceUploadIntent } from "./resource-upload-intent";
import {
  RESOURCE_PUT_PRESIGN_TTL_MS,
  assertResourceUploadUrlAuthorized,
  createResourcePutPresignedUrl,
  parseResourceUploadUrlBody,
} from "./resource-presigned-put";

const PREVIEW_PATH = `marketing/public/${"a".repeat(32)}.png`;
const FILE_PATH = `marketing/private/${"b".repeat(32)}.pdf`;

const originalSecret = process.env.ADMIN_SESSION_SECRET;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "resource-upload-intent-test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
});

test("upload URL route rejects unauthenticated access via marketing auth guard", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
  assert.equal(marketingAuthError(true), null);
});

test("upload URL body requires uploadIntent pathname and role", () => {
  assert.throws(() => parseResourceUploadUrlBody({}));
  assert.throws(() => parseResourceUploadUrlBody({ uploadIntent: "x", pathname: PREVIEW_PATH }));
  const parsed = parseResourceUploadUrlBody({
    uploadIntent: "intent",
    pathname: PREVIEW_PATH,
    role: "preview",
  });
  assert.equal(parsed.role, "preview");
});

test("upload URL authorization rejects invalid upload intent", () => {
  assert.throws(() =>
    assertResourceUploadUrlAuthorized("not.valid", PREVIEW_PATH, "preview", "owner"),
  );
});

test("upload URL authorization rejects pathname mismatch", () => {
  const { uploadIntent } = issueResourceUploadIntent({
    username: "owner",
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
  });
  assert.throws(() =>
    assertResourceUploadUrlAuthorized(uploadIntent, FILE_PATH, "preview", "owner"),
  );
});

test("preview role passes authorization for preview pathname", () => {
  const { uploadIntent } = issueResourceUploadIntent({
    username: "owner",
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
  });
  assertResourceUploadUrlAuthorized(uploadIntent, PREVIEW_PATH, "preview", "owner");
});

test("file role passes authorization for file pathname", () => {
  const { uploadIntent } = issueResourceUploadIntent({
    username: "owner",
    previewPathname: PREVIEW_PATH,
    filePathname: FILE_PATH,
  });
  assertResourceUploadUrlAuthorized(uploadIntent, FILE_PATH, "file", "owner");
});

test("presigned URL TTL is fifteen minutes", () => {
  assert.equal(RESOURCE_PUT_PRESIGN_TTL_MS, 15 * 60 * 1000);
});

test(
  "preview gets a PUT presigned URL without returning blob credentials",
  { skip: !process.env.BLOB_READ_WRITE_TOKEN?.trim() },
  async () => {
    const issued = await createResourcePutPresignedUrl({ pathname: PREVIEW_PATH, role: "preview" });
    assert.match(issued.presignedUrl, /^https:\/\//);
    assert.equal(issued.pathname, PREVIEW_PATH);
    assert.ok(issued.validUntil > Date.now());
    assert.ok(issued.validUntil <= Date.now() + RESOURCE_PUT_PRESIGN_TTL_MS + 5_000);
    assert.ok(issued.publicUrl?.includes(PREVIEW_PATH));
    const serialized = JSON.stringify(issued);
    assert.doesNotMatch(serialized, /BLOB_READ_WRITE_TOKEN/i);
    assert.doesNotMatch(serialized, /clientSigningToken/);
    assert.doesNotMatch(serialized, /delegationToken/);
  },
);

test(
  "file gets a PUT presigned URL without returning blob credentials",
  { skip: !process.env.BLOB_READ_WRITE_TOKEN?.trim() },
  async () => {
    const issued = await createResourcePutPresignedUrl({ pathname: FILE_PATH, role: "file" });
    assert.match(issued.presignedUrl, /^https:\/\//);
    assert.equal(issued.pathname, FILE_PATH);
    assert.equal(issued.publicUrl, undefined);
    const serialized = JSON.stringify(issued);
    assert.doesNotMatch(serialized, /BLOB_READ_WRITE_TOKEN/i);
    assert.doesNotMatch(serialized, /clientSigningToken/);
    assert.doesNotMatch(serialized, /delegationToken/);
  },
);
