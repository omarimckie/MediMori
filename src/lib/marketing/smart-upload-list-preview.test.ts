import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveSmartUploadStagedListPreviewSrc,
  shouldUseSmartUploadLocalFilePreview,
} from "./smart-upload-list-preview";

const PATH = `marketing/public/${"a".repeat(32)}.png`;
const INTENT = "intent-token";

test("local file preview before staging", () => {
  assert.equal(shouldUseSmartUploadLocalFilePreview({ pathname: null, uploadIntent: null }), true);
  assert.equal(resolveSmartUploadStagedListPreviewSrc({ pathname: null, uploadIntent: null }), null);
});

test("staged list preview uses staged-image API", () => {
  assert.equal(
    shouldUseSmartUploadLocalFilePreview({ pathname: PATH, uploadIntent: INTENT }),
    false,
  );
  const url = resolveSmartUploadStagedListPreviewSrc({
    pathname: PATH,
    uploadIntent: INTENT,
  });
  assert.ok(url);
  assert.match(url!, /staged-image\?/);
  assert.match(url!, /pathname=/);
});

test("local-multipart uses local file preview only", () => {
  assert.equal(
    shouldUseSmartUploadLocalFilePreview({
      pathname: "local-multipart",
      uploadIntent: "local-multipart",
    }),
    true,
  );
  assert.equal(
    resolveSmartUploadStagedListPreviewSrc({
      pathname: "local-multipart",
      uploadIntent: "local-multipart",
    }),
    null,
  );
});
