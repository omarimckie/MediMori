import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMarketingBlobCredentials, hasMarketingBlobToken } from "./marketing-blob";
import { resourceBlobStorageUnavailableMessage } from "./resource-multipart-fallback";

test("credential matrix: RW token only -> configured", () => {
  assert.equal(
    hasMarketingBlobCredentials({ BLOB_READ_WRITE_TOKEN: "rw-token" }),
    true,
  );
});

test("credential matrix: OIDC token + store ID -> configured", () => {
  assert.equal(
    hasMarketingBlobCredentials({
      VERCEL_OIDC_TOKEN: "oidc",
      BLOB_STORE_ID: "store_abc",
    }),
    true,
  );
});

test("credential matrix: OIDC token only -> not configured", () => {
  assert.equal(hasMarketingBlobCredentials({ VERCEL_OIDC_TOKEN: "oidc" }), false);
});

test("credential matrix: store ID only -> not configured", () => {
  assert.equal(hasMarketingBlobCredentials({ BLOB_STORE_ID: "store_abc" }), false);
});

test("credential matrix: neither -> not configured", () => {
  assert.equal(hasMarketingBlobCredentials({}), false);
});

test("credential matrix: whitespace values -> not configured", () => {
  assert.equal(
    hasMarketingBlobCredentials({
      BLOB_READ_WRITE_TOKEN: "   ",
      VERCEL_OIDC_TOKEN: " ",
      BLOB_STORE_ID: "\t",
    }),
    false,
  );
});

test("hasMarketingBlobToken remains compatible with credential helper", () => {
  assert.equal(
    hasMarketingBlobToken({ BLOB_READ_WRITE_TOKEN: "legacy" }),
    hasMarketingBlobCredentials({ BLOB_READ_WRITE_TOKEN: "legacy" }),
  );
});

test("blob unavailable message mentions OIDC and legacy token", () => {
  const message = resourceBlobStorageUnavailableMessage();
  assert.match(message, /BLOB_READ_WRITE_TOKEN/i);
  assert.match(message, /VERCEL_OIDC_TOKEN/i);
  assert.match(message, /BLOB_STORE_ID/i);
});
