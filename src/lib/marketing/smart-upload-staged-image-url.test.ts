import assert from "node:assert/strict";
import { test } from "node:test";
import { smartUploadStagedImageUrl } from "./smart-upload-staged-image-url";

const PATH = `marketing/public/${"c".repeat(32)}.png`;
const INTENT = "payload.signature";

test("smartUploadStagedImageUrl encodes pathname and uploadIntent", () => {
  const url = smartUploadStagedImageUrl({ pathname: PATH, uploadIntent: INTENT });
  assert.match(url, /^\/api\/admin\/marketing\/smart-upload\/staged-image\?/);
  const query = url.split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  assert.equal(params.get("pathname"), PATH);
  assert.equal(params.get("uploadIntent"), INTENT);
});

test("smartUploadStagedImageUrl does not use blob host", () => {
  const url = smartUploadStagedImageUrl({ pathname: PATH, uploadIntent: INTENT });
  assert.doesNotMatch(url, /blob\.vercel-storage\.com/);
  assert.doesNotMatch(url, /\/api\/marketing\/assets\//);
});
