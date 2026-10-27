import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canStartPreviewGeneration,
  invalidateAcceptedBeforePreviewRegeneration,
} from "./smart-upload-preview-client";

test("regeneration invalidates acceptance before old preview deletion", () => {
  const reset = invalidateAcceptedBeforePreviewRegeneration();
  assert.equal(reset.acceptedPreview, null);
  assert.equal(reset.status, "needs_attention");
});

test("duplicate Generate Preview guarded per entry", () => {
  assert.equal(canStartPreviewGeneration("entry-a", null), true);
  assert.equal(canStartPreviewGeneration("entry-a", "entry-a"), false);
  assert.equal(canStartPreviewGeneration("entry-b", "entry-a"), true);
});
