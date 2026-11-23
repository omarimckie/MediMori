import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSmartUploadDestinations,
  parseSmartUploadDestinationsRecord,
} from "./smart-upload-destinations";
import { isMp4VideoBuffer, tiktokVideoOnlyDestinations } from "./smart-upload-tiktok";
import { validateSmartUploadImageBytes } from "./smart-upload";

test("parseSmartUploadDestinationsRecord accepts tiktok flag", () => {
  const d = parseSmartUploadDestinationsRecord({
    facebook: false,
    instagram: false,
    pinterest: false,
    tiktok: true,
  });
  assert.equal(d.tiktok, true);
});

test("tiktokVideoOnlyDestinations detects video-only selection", () => {
  const d = normalizeSmartUploadDestinations({
    facebook: false,
    instagram: false,
    pinterest: false,
    tiktok: true,
  });
  assert.equal(tiktokVideoOnlyDestinations(d), true);
});

test("isMp4VideoBuffer detects ftyp box", () => {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(12, 0);
  buf.write("ftyp", 4);
  assert.equal(isMp4VideoBuffer(buf), true);
});

test("validateSmartUploadImageBytes accepts mp4 for tiktok-only", async () => {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(12, 0);
  buf.write("ftyp", 4);
  const result = await validateSmartUploadImageBytes(buf, {
    facebook: false,
    instagram: false,
    pinterest: false,
    tiktok: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mediaKind, "video");
  }
});

test("validateSmartUploadImageBytes rejects mp4 with meta selected", async () => {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(12, 0);
  buf.write("ftyp", 4);
  const result = await validateSmartUploadImageBytes(buf, {
    facebook: true,
    instagram: true,
    pinterest: false,
    tiktok: true,
  });
  assert.equal(result.ok, false);
});