import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeStaleCaption,
  buildCaptionInputFingerprint,
  composeSharedCaptionPreview,
  createDefaultCaptionAssistantState,
  findSubmitValidCaptionPreflightFailure,
  hasSubmittableSharedCaption,
  isCaptionDraftStale,
  type CaptionAssistantState,
  type CaptionFingerprintContext,
  type SubmitValidCaptionPreflightEntry,
} from "./smart-upload-caption-client-state";

function baseContext(overrides: Partial<CaptionFingerprintContext> = {}): CaptionFingerprintContext {
  return {
    mode: "shared",
    instructions: "",
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    originalPathname: "/marketing/public/abc.png",
    originalUploadIntent: "intent.a",
    acceptedDerivative: null,
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    finalizeKey: "fk-1",
    ...overrides,
  };
}

function withGeneratedFrom(
  state: CaptionAssistantState,
  context: CaptionFingerprintContext,
): CaptionAssistantState {
  return {
    ...state,
    generatedFrom: buildCaptionInputFingerprint(context),
    genStatus: "generated",
  };
}

test("default state is shared mode", () => {
  const state = createDefaultCaptionAssistantState();
  assert.equal(state.mode, "shared");
  assert.equal(state.genStatus, "idle");
  assert.deepEqual(state.shared, { body: "", cta: "", instagramHashtags: [] });
});

test("separate files get independent state via factory", () => {
  const a = createDefaultCaptionAssistantState();
  const b = createDefaultCaptionAssistantState();
  a.shared.body = "one";
  b.shared.body = "two";
  assert.equal(a.shared.body, "one");
  assert.equal(b.shared.body, "two");
});

test("body edit does not stale", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  const edited = { ...state, shared: { ...state.shared, body: "manual" } };
  assert.equal(isCaptionDraftStale(edited, ctx), false);
});

test("CTA edit does not stale", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  const edited = { ...state, shared: { ...state.shared, cta: "Read the book" } };
  assert.equal(isCaptionDraftStale(edited, ctx), false);
});

test("hashtag edit does not stale", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  const edited = {
    ...state,
    shared: { ...state.shared, instagramHashtags: ["KidsHealth"] },
  };
  assert.equal(isCaptionDraftStale(edited, ctx), false);
});

test("instructions participate in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(state, baseContext({ instructions: "  warmer tone  " })),
    true,
  );
});

test("bookId participates in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(isCaptionDraftStale(state, baseContext({ bookId: "book-one" })), true);
});

test("campaignId participates in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(isCaptionDraftStale(state, baseContext({ campaignId: "camp-1" })), true);
});

test("audience participates in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(state, baseContext({ advanced: { category: null, audience: "schools" } })),
    true,
  );
});

test("category participates in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(
      state,
      baseContext({ advanced: { category: "brand_story", audience: null } }),
    ),
    true,
  );
});

test("original image identity participates in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(state, baseContext({ originalPathname: "/other.png" })),
    true,
  );
  assert.equal(
    isCaptionDraftStale(state, baseContext({ originalUploadIntent: "other" })),
    true,
  );
});

test("derivative identity participates in fingerprint", () => {
  const ctx = baseContext({
    acceptedDerivative: { pathname: "/d.png", uploadIntent: "d.i" },
  });
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(
      state,
      baseContext({
        acceptedDerivative: { pathname: "/d2.png", uploadIntent: "d.i" },
      }),
    ),
    true,
  );
});

test("strategy participates in fingerprint", () => {
  const ctx = baseContext({
    acceptedDerivative: { pathname: "/d.png", uploadIntent: "d.i" },
    fixStrategy: "pad",
  });
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(state, baseContext({ acceptedDerivative: { pathname: "/d.png", uploadIntent: "d.i" }, fixStrategy: "crop" })),
    true,
  );
});

test("targetRatio participates in fingerprint", () => {
  const ctx = baseContext({
    acceptedDerivative: { pathname: "/d.png", uploadIntent: "d.i" },
    fixTargetRatio: "4:5",
  });
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(
    isCaptionDraftStale(
      state,
      baseContext({
        acceptedDerivative: { pathname: "/d.png", uploadIntent: "d.i" },
        fixTargetRatio: "1:1",
      }),
    ),
    true,
  );
});

test("finalizeKey participates in fingerprint", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(isCaptionDraftStale(state, baseContext({ finalizeKey: "fk-2" })), true);
});

test("weeklyPlanId is absent from fingerprint model", () => {
  const ctx = baseContext({ bookId: "book-one" });
  const fp = buildCaptionInputFingerprint(ctx);
  assert.equal("weeklyPlanId" in fp, false);
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(isCaptionDraftStale(state, ctx), false);
});

test("compose preview body only", () => {
  assert.equal(composeSharedCaptionPreview({ body: "Hello", cta: "", instagramHashtags: [] }), "Hello");
});

test("compose preview body + CTA", () => {
  assert.equal(
    composeSharedCaptionPreview({ body: "Hello", cta: "Read more", instagramHashtags: [] }),
    "Hello\n\nRead more",
  );
});

test("compose preview body + CTA + hashtags", () => {
  assert.equal(
    composeSharedCaptionPreview({
      body: "Hello",
      cta: "Read more",
      instagramHashtags: ["KidsHealth", "SickleCell"],
    }),
    "Hello\n\nRead more\n\n#KidsHealth #SickleCell",
  );
});

test("compose preview omits empty CTA and hashtags", () => {
  assert.equal(
    composeSharedCaptionPreview({ body: "Hello", cta: "   ", instagramHashtags: [] }),
    "Hello",
  );
});

test("acknowledgeStaleCaption sets flag when stale", () => {
  const ctx = baseContext();
  let state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  state = { ...state, stale: true };
  const ack = acknowledgeStaleCaption(state);
  assert.equal(ack.staleAcknowledged, true);
});

function preflightRow(
  overrides: Partial<SubmitValidCaptionPreflightEntry> & { fileName: string },
): SubmitValidCaptionPreflightEntry {
  return {
    status: "ready",
    uploadIntent: "intent",
    acceptedDerivative: null,
    previewDerivative: null,
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    shared: { body: "", cta: "", instagramHashtags: [] },
    ...overrides,
  };
}

test("hasSubmittableSharedCaption body only", () => {
  assert.equal(hasSubmittableSharedCaption({ body: "Hello", cta: "", instagramHashtags: [] }), true);
});

test("hasSubmittableSharedCaption CTA only", () => {
  assert.equal(hasSubmittableSharedCaption({ body: "", cta: "Read more", instagramHashtags: [] }), true);
});

test("hasSubmittableSharedCaption body + CTA", () => {
  assert.equal(
    hasSubmittableSharedCaption({ body: "Hello", cta: "Read more", instagramHashtags: [] }),
    true,
  );
});

test("hasSubmittableSharedCaption body + hashtags", () => {
  assert.equal(
    hasSubmittableSharedCaption({ body: "Hello", cta: "", instagramHashtags: ["Asthma"] }),
    true,
  );
});

test("hasSubmittableSharedCaption CTA + hashtags", () => {
  assert.equal(
    hasSubmittableSharedCaption({ body: "", cta: "Read more", instagramHashtags: ["Asthma"] }),
    true,
  );
});

test("hasSubmittableSharedCaption hashtags only", () => {
  assert.equal(hasSubmittableSharedCaption({ body: "", cta: "", instagramHashtags: ["Asthma"] }), false);
});

test("hasSubmittableSharedCaption whitespace body and CTA with hashtags", () => {
  assert.equal(
    hasSubmittableSharedCaption({ body: "   ", cta: "   ", instagramHashtags: ["Asthma"] }),
    false,
  );
});

test("hasSubmittableSharedCaption all empty", () => {
  assert.equal(hasSubmittableSharedCaption({ body: "", cta: "", instagramHashtags: [] }), false);
});

test("hashtag-only compose preview is nonempty but not submittable", () => {
  const draft = { body: "", cta: "", instagramHashtags: ["Asthma"] };
  assert.equal(composeSharedCaptionPreview(draft), "#Asthma");
  assert.equal(hasSubmittableSharedCaption(draft), false);
});

test("preflight fails when ready submittable file lacks body and CTA", () => {
  const failure = findSubmitValidCaptionPreflightFailure([
    preflightRow({ fileName: "a.png", shared: { body: "A", cta: "", instagramHashtags: [] } }),
    preflightRow({ fileName: "b.png", shared: { body: "", cta: "", instagramHashtags: [] } }),
  ]);
  assert.equal(failure, "b.png");
});

test("preflight ignores failed file with empty caption", () => {
  const failure = findSubmitValidCaptionPreflightFailure([
    preflightRow({ fileName: "a.png", shared: { body: "A", cta: "", instagramHashtags: [] } }),
    preflightRow({ fileName: "b.png", status: "failed" }),
  ]);
  assert.equal(failure, null);
});

test("preflight ignores needs_attention file with empty caption", () => {
  const failure = findSubmitValidCaptionPreflightFailure([
    preflightRow({ fileName: "a.png", shared: { body: "A", cta: "", instagramHashtags: [] } }),
    preflightRow({ fileName: "b.png", status: "needs_attention" }),
  ]);
  assert.equal(failure, null);
});

test("preflight ignores submitted file with empty caption", () => {
  const failure = findSubmitValidCaptionPreflightFailure([
    preflightRow({ fileName: "a.png", shared: { body: "A", cta: "", instagramHashtags: [] } }),
    preflightRow({ fileName: "b.png", status: "submitted" }),
  ]);
  assert.equal(failure, null);
});
