import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESOURCE_MULTIPART_FALLBACK_MAX_BYTES,
  isVercelDeployedRuntime,
  resourceBlobStorageUnavailableMessage,
  shouldUseResourceMultipartFallbackWhenBlobUnavailable,
} from "./resource-multipart-fallback";

const smallBytes = RESOURCE_MULTIPART_FALLBACK_MAX_BYTES - 1;
const largeBytes = RESOURCE_MULTIPART_FALLBACK_MAX_BYTES + 1;

test("local dev without Vercel may use multipart fallback when blob intent returns 503", () => {
  assert.equal(isVercelDeployedRuntime({}), false);
  assert.equal(
    shouldUseResourceMultipartFallbackWhenBlobUnavailable(smallBytes, {
      blobIntentStatus503: true,
      env: {},
    }),
    true,
  );
});

test("Vercel deployment rejects multipart fallback when blob intent returns 503", () => {
  assert.equal(isVercelDeployedRuntime({ VERCEL: "1" }), true);
  assert.equal(
    shouldUseResourceMultipartFallbackWhenBlobUnavailable(smallBytes, {
      blobIntentStatus503: true,
      env: { VERCEL: "1", VERCEL_ENV: "production" },
    }),
    false,
  );
  assert.equal(
    shouldUseResourceMultipartFallbackWhenBlobUnavailable(smallBytes, {
      blobIntentStatus503: true,
      env: { VERCEL: "1", VERCEL_ENV: "preview" },
    }),
    false,
  );
});

test("multipart fallback is not used without 503 or when files exceed limit", () => {
  assert.equal(
    shouldUseResourceMultipartFallbackWhenBlobUnavailable(smallBytes, {
      blobIntentStatus503: false,
      env: {},
    }),
    false,
  );
  assert.equal(
    shouldUseResourceMultipartFallbackWhenBlobUnavailable(largeBytes, {
      blobIntentStatus503: true,
      env: {},
    }),
    false,
  );
});

test("blob unavailable message mentions Vercel configuration", () => {
  assert.match(resourceBlobStorageUnavailableMessage(), /BLOB_READ_WRITE_TOKEN/i);
});
