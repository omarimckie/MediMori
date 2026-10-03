import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const clientSource = readFileSync(
  path.join(process.cwd(), "src/components/admin/marketing/SmartUploadClient.tsx"),
  "utf8",
);

test("original preview pane uses staged-image route not publicUrl", () => {
  assert.match(clientSource, /pathname: item\.pathname,\s*\n\s*uploadIntent: item\.uploadIntent/);
  assert.doesNotMatch(clientSource, /src=\{item\.publicUrl\}/);
});

test("corrected preview pane uses staged-image route not previewSignedUrl", () => {
  assert.match(clientSource, /pathname: item\.preview\.pathname/);
  assert.match(clientSource, /uploadIntent: item\.preview\.uploadIntent/);
  assert.doesNotMatch(clientSource, /previewSignedUrl/);
});

test("smart-upload preview fix no longer emits previewSignedUrl", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/marketing/smart-upload.ts"), "utf8");
  const fn = source.slice(
    source.indexOf("export async function generateSmartUploadPreviewFix"),
    source.indexOf("export async function discardSmartUploadPreviewDerivative"),
  );
  assert.doesNotMatch(fn, /previewSignedUrl/);
  assert.doesNotMatch(fn, /createMarketingPublicImageSignedGetUrl/);
});
