import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveUploadStatusAfterValidation,
  isCaptionImagePreparationReady,
  isMetaImageReady,
  isPinterestImageReady,
  isSmartUploadSubmissionReady,
  metaImageNeedsAspectFix,
  pinterestImageNeedsAspectFix,
  validationIssuesAfterAcceptingPinterestFix,
} from "./smart-upload-ui-readiness";

const ALL = { facebook: true, instagram: true, pinterest: true };
const META_ONLY = { facebook: true, instagram: true, pinterest: false };
const PIN_ONLY = { facebook: false, instagram: false, pinterest: true };

const PIN_ISSUE = {
  code: "invalid_aspect_ratio",
  platform: "pinterest",
  message: "Pinterest pin aspect ratio is outside the allowed range.",
};

test("square all-three: meta ready, pinterest needs fix", () => {
  const issues = [PIN_ISSUE];
  assert.equal(isMetaImageReady(ALL, issues, false), true);
  assert.equal(isPinterestImageReady(ALL, issues, false), false);
  assert.equal(pinterestImageNeedsAspectFix(ALL, issues, false), true);
  assert.equal(metaImageNeedsAspectFix(ALL, issues, false), false);
  assert.equal(isSmartUploadSubmissionReady(ALL, issues, false, false), false);
  assert.equal(deriveUploadStatusAfterValidation(ALL, issues, false, false), "needs_attention");
  assert.equal(isCaptionImagePreparationReady(ALL, issues, false), true);
});

test("pinterest accepted clears submission block", () => {
  const issues = [PIN_ISSUE];
  const after = validationIssuesAfterAcceptingPinterestFix(issues);
  assert.deepEqual(after, []);
  assert.equal(isSmartUploadSubmissionReady(ALL, after, false, true), true);
  assert.equal(deriveUploadStatusAfterValidation(ALL, after, false, true), "ready");
});

test("meta-only workflow ignores pinterest issues when pinterest deselected", () => {
  assert.equal(isSmartUploadSubmissionReady(META_ONLY, [], false, false), true);
  assert.equal(pinterestImageNeedsAspectFix(META_ONLY, [PIN_ISSUE], false), false);
});

test("pinterest-only ready with accepted pin preview", () => {
  assert.equal(isSmartUploadSubmissionReady(PIN_ONLY, [], false, true), true);
});

const META_ISSUE = {
  code: "invalid_aspect_ratio",
  platform: "instagram",
  message: "Instagram aspect ratio is outside the allowed range.",
};

test("tall all-three: pinterest ready, meta needs fix", () => {
  const issues = [META_ISSUE];
  assert.equal(isPinterestImageReady(ALL, issues, false), true);
  assert.equal(isMetaImageReady(ALL, issues, false), false);
  assert.equal(metaImageNeedsAspectFix(ALL, issues, false), true);
  assert.equal(isCaptionImagePreparationReady(ALL, issues, false), false);
});

test("square meta-only passes without pinterest fix", () => {
  assert.equal(isSmartUploadSubmissionReady(META_ONLY, [], false, false), true);
  assert.equal(deriveUploadStatusAfterValidation(META_ONLY, [], false, false), "ready");
});
