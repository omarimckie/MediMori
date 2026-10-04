import assert from "node:assert/strict";
import { test } from "node:test";
import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";
import { assertClinicalHashtagsSafe } from "./smart-upload-caption-hashtag-safety";

test("rejects AsthmaCure style hashtags", () => {
  assert.throws(() => assertClinicalHashtagsSafe(["#AsthmaCure"]), SmartUploadCaptionGroundingError);
});

test("rejects PreventSickleCell style hashtags", () => {
  assert.throws(() => assertClinicalHashtagsSafe(["PreventSickleCell"]), SmartUploadCaptionGroundingError);
});

test("allows KidsHealth and ChildrensBooks", () => {
  assertClinicalHashtagsSafe(["KidsHealth", "ChildrensBooks"]);
});
