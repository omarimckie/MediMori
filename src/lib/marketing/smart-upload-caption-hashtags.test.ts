import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeInstagramHashtags,
  SMART_UPLOAD_INSTAGRAM_HASHTAG_MAX,
} from "./smart-upload-caption-hashtags";

test("normalizeInstagramHashtags adds # and dedupes case-insensitively", () => {
  const tags = normalizeInstagramHashtags(["twilightfeather", "#TwilightFeather", "  #Parenting  "]);
  assert.deepEqual(tags, ["#twilightfeather", "#Parenting"]);
});

test("normalizeInstagramHashtags caps at max", () => {
  const input = Array.from({ length: 12 }, (_, i) => `tag${i}`);
  const tags = normalizeInstagramHashtags(input);
  assert.equal(tags.length, SMART_UPLOAD_INSTAGRAM_HASHTAG_MAX);
});
