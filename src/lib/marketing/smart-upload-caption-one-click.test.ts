import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureStagedForCaptionGeneration,
  type CaptionGenerationFileSnapshot,
} from "./smart-upload-caption-one-click";

function freshUnstaged(): CaptionGenerationFileSnapshot {
  return {
    uploadIntent: null,
    pathname: null,
    publicUrl: null,
    status: "ready",
    error: null,
    finalizeKey: "fk-1",
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    captionImagePreparationReady: false,
    acceptedPreview: null,
    preview: null,
  };
}

function stagedReady(overrides: Partial<CaptionGenerationFileSnapshot> = {}): CaptionGenerationFileSnapshot {
  return {
    uploadIntent: "intent.upload",
    pathname: "marketing/public/abc.png",
    publicUrl: "https://example.blob/marketing/public/abc.png",
    status: "ready",
    error: null,
    finalizeKey: "fk-1",
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    captionImagePreparationReady: true,
    acceptedPreview: null,
    preview: null,
    ...overrides,
  };
}

test("A: fresh image → valid stage → continues in same invocation with returned refs", async () => {
  let stageCalls = 0;
  let generateCalls = 0;

  const fresh = freshUnstaged();
  const prepared = await ensureStagedForCaptionGeneration(fresh, async () => {
    stageCalls += 1;
    return stagedReady({
      uploadIntent: "intent.from-stage",
      pathname: "marketing/public/staged.png",
    });
  });

  assert.equal(stageCalls, 1);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.stagedInThisCall, true);
  assert.equal(prepared.file.uploadIntent, "intent.from-stage");
  assert.equal(prepared.file.pathname, "marketing/public/staged.png");

  const body = {
    originalUploadIntent: prepared.file.uploadIntent,
    originalPathname: prepared.file.pathname,
  };
  assert.equal(body.originalUploadIntent, "intent.from-stage");
  generateCalls += 1;
  assert.equal(generateCalls, 1);
});

test("B: fresh image → needs_attention → no generation path", async () => {
  const result = await ensureStagedForCaptionGeneration(freshUnstaged(), async () => ({
    ...stagedReady(),
    status: "needs_attention",
    error: "Invalid aspect ratio",
  }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /validation issues/i);
});

test("C: fresh image → upload failure → no generation path", async () => {
  const result = await ensureStagedForCaptionGeneration(freshUnstaged(), async () => ({
    ...freshUnstaged(),
    status: "failed",
    error: "Direct blob upload failed (403).",
  }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /upload failed/i);
});

test("D: already staged valid image → no stage callback required", async () => {
  let stageCalls = 0;
  const result = await ensureStagedForCaptionGeneration(stagedReady(), async () => {
    stageCalls += 1;
    return stagedReady();
  });
  assert.equal(stageCalls, 0);
  assert.equal(result.ok, true);
});

test("E: accepted derivative → readiness uses accepted preview alignment", async () => {
  const result = await ensureStagedForCaptionGeneration(
    stagedReady({
      acceptedPreview: {
        uploadIntent: "intent.derivative",
        pathname: "marketing/public/derivative.png",
        strategy: "pad",
        targetRatio: "4:5",
      },
      preview: { strategy: "pad", targetRatio: "4:5" },
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
    }),
    async () => stagedReady(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.file.acceptedPreview?.pathname, "marketing/public/derivative.png");
});

test("E: preview out of sync with fix settings blocks generation", async () => {
  const result = await ensureStagedForCaptionGeneration(
    stagedReady({
      acceptedPreview: {
        uploadIntent: "intent.derivative",
        pathname: "marketing/public/derivative.png",
        strategy: "pad",
        targetRatio: "4:5",
      },
      preview: { strategy: "crop", targetRatio: "1:1" },
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
    }),
    async () => stagedReady(),
  );
  assert.equal(result.ok, false);
});

test("F: duplicate stage is not invoked when already staged", async () => {
  let stageCalls = 0;
  await ensureStagedForCaptionGeneration(stagedReady(), async () => {
    stageCalls += 1;
    return stagedReady();
  });
  assert.equal(stageCalls, 0);
});

test("needs_attention with meta caption ready allows generation (Pinterest fix pending)", async () => {
  const result = await ensureStagedForCaptionGeneration(
    stagedReady({
      status: "needs_attention",
      captionImagePreparationReady: true,
    }),
    async () => stagedReady(),
  );
  assert.equal(result.ok, true);
});

test("needs_attention without meta caption ready blocks generation", async () => {
  const result = await ensureStagedForCaptionGeneration(
    stagedReady({
      status: "needs_attention",
      captionImagePreparationReady: false,
    }),
    async () => stagedReady(),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /validation issues/i);
});

test("regression: one-click uses stage return value not pre-stage snapshot", async () => {
  const fresh = freshUnstaged();
  const prepared = await ensureStagedForCaptionGeneration(fresh, async () =>
    stagedReady({
      uploadIntent: "intent.after-upload",
      pathname: "marketing/public/after.png",
    }),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.notEqual(fresh.uploadIntent, prepared.file.uploadIntent);
  assert.equal(prepared.file.uploadIntent, "intent.after-upload");
});
