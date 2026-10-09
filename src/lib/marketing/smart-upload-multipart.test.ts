import assert from "node:assert/strict";
import { test } from "node:test";
import { isVercelDeployedRuntime, shouldUseResourceMultipartFallbackWhenBlobUnavailable } from "./resource-multipart-fallback";
import {
  localMultipartSmartUploadFinalizeBlockedReason,
  parseSmartUploadDestinationsFormValue,
} from "./smart-upload-multipart";

const ALL = { facebook: true, instagram: true, pinterest: true };
const META_ONLY = { facebook: true, instagram: true, pinterest: false };

const PIN_ISSUE = {
  code: "invalid_aspect_ratio",
  platform: "pinterest",
  message: "Pinterest pin aspect ratio is outside the allowed range.",
};

test("multipart fallback is disabled on Vercel production runtime", () => {
  assert.equal(
    shouldUseResourceMultipartFallbackWhenBlobUnavailable(1024, {
      blobIntentStatus503: true,
      env: { VERCEL: "1", VERCEL_ENV: "production" },
    }),
    false,
  );
  assert.equal(isVercelDeployedRuntime({ VERCEL: "1" }), true);
});

test("parseSmartUploadDestinationsFormValue reads JSON destinations", () => {
  const parsed = parseSmartUploadDestinationsFormValue(
    JSON.stringify({ facebook: false, instagram: false, pinterest: true }),
  );
  assert.equal(parsed.pinterest, true);
  assert.equal(parsed.facebook, false);
});

test("multipart finalize blocks accepted blob derivatives", () => {
  const reason = localMultipartSmartUploadFinalizeBlockedReason(ALL, {
    acceptedMetaPreview: true,
    acceptedPinterestPreview: false,
    validationIssues: [],
  });
  assert.match(reason ?? "", /Blob storage/i);
});

test("multipart finalize blocks square all-three until pinterest aspect is fixed", () => {
  const reason = localMultipartSmartUploadFinalizeBlockedReason(ALL, {
    acceptedMetaPreview: false,
    acceptedPinterestPreview: false,
    validationIssues: [PIN_ISSUE],
  });
  assert.match(reason ?? "", /Blob storage/i);
});

test("multipart finalize allows meta-only when validation is clean", () => {
  const reason = localMultipartSmartUploadFinalizeBlockedReason(META_ONLY, {
    acceptedMetaPreview: false,
    acceptedPinterestPreview: false,
    validationIssues: [],
  });
  assert.equal(reason, null);
});

test("multipart finalize allows pinterest-only when pin validation is clean", () => {
  const reason = localMultipartSmartUploadFinalizeBlockedReason(
    { facebook: false, instagram: false, pinterest: true },
    {
      acceptedMetaPreview: false,
      acceptedPinterestPreview: false,
      validationIssues: [],
    },
  );
  assert.equal(reason, null);
});
