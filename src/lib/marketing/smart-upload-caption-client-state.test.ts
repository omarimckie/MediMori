import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeStaleCaption,
  buildCaptionGenerationSnapshot,
  buildCaptionInputFingerprint,
  buildCaptionFinalizePayload,
  composeFacebookCaptionPreview,
  composeInstagramCaptionPreview,
  composeSharedCaptionPreview,
  createDefaultCaptionAssistantState,
  findSubmitValidCaptionPreflightFailure,
  findSubmitValidCaptionPreflightIssue,
  hasReviewedDraftContent,
  hasSubmittablePerPlatformCaptions,
  hasSubmittableSharedCaption,
  isCaptionDraftStale,
  refreshCaptionAssistantStale,
  setCaptionAssistantMode,
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
    generatedFrom: buildCaptionGenerationSnapshot(context, null),
    genStatus: "generated",
  };
}

function preflightRowWithAssistant(
  overrides: Partial<SubmitValidCaptionPreflightEntry> & { fileName: string },
): SubmitValidCaptionPreflightEntry {
  return {
    ...preflightRow(overrides),
    generatedFrom: overrides.generatedFrom ?? null,
    stale: overrides.stale ?? false,
    staleAcknowledged: overrides.staleAcknowledged ?? false,
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
  const ctx = baseContext({ instructions: "Keep the caption concise." });
  let state = withGeneratedFrom(createDefaultCaptionAssistantState(), baseContext());
  state = refreshCaptionAssistantStale(
    { ...state, instructions: "Keep the caption concise." },
    ctx,
  );
  assert.equal(state.stale, true);
  const ack = acknowledgeStaleCaption(state, ctx);
  assert.equal(ack.staleAcknowledged, true);
  assert.ok(ack.staleAcknowledgedFingerprint);
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
    mode: "shared",
    shared: { body: "", cta: "", instagramHashtags: [] },
    facebook: { body: "", cta: "" },
    instagram: { body: "", cta: "", instagramHashtags: [] },
    pinterest: { title: "", description: "" },
    destinations: { facebook: true, instagram: true, pinterest: true },
    generatedFrom: null,
    stale: false,
    staleAcknowledged: false,
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

test("CTA edit does not stale after generation", () => {
  const ctx = baseContext();
  const state = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  const edited = { ...state, shared: { ...state.shared, cta: "Edited CTA" } };
  assert.equal(isCaptionDraftStale(edited, ctx), false);
});

test("hasReviewedDraftContent includes hashtags only", () => {
  assert.equal(hasReviewedDraftContent({ body: "", cta: "", instagramHashtags: ["Asthma"] }), true);
});

test("preflight blocks stale unacknowledged generated caption", () => {
  const ctx = baseContext();
  const issue = findSubmitValidCaptionPreflightIssue([
    preflightRowWithAssistant({
      fileName: "a.png",
      shared: { body: "A", cta: "", instagramHashtags: [] },
      generatedFrom: buildCaptionGenerationSnapshot(ctx, null),
      stale: true,
      staleAcknowledged: false,
    }),
  ]);
  assert.equal(issue?.kind, "stale_generated");
});

test("preflight allows stale acknowledged generated caption", () => {
  const ctx = baseContext();
  const issue = findSubmitValidCaptionPreflightIssue([
    preflightRowWithAssistant({
      fileName: "a.png",
      shared: { body: "A", cta: "", instagramHashtags: [] },
      generatedFrom: buildCaptionGenerationSnapshot(ctx, null),
      stale: true,
      staleAcknowledged: true,
    }),
  ]);
  assert.equal(issue, null);
});

test("regression: instructions change after generation marks stale via refresh", () => {
  const ctxBlank = baseContext({ instructions: "" });
  const state = withGeneratedFrom(
    { ...createDefaultCaptionAssistantState(), instructions: "" },
    ctxBlank,
  );
  assert.equal(refreshCaptionAssistantStale(state, ctxBlank).stale, false);

  const afterInstructionsEdit = {
    ...state,
    instructions: "Keep the caption concise.",
  };
  const ctxNew = baseContext({ instructions: "Keep the caption concise." });
  const refreshed = refreshCaptionAssistantStale(afterInstructionsEdit, ctxNew);
  assert.equal(refreshed.stale, true);
  assert.equal(refreshed.staleAcknowledged, false);
  assert.equal(refreshed.staleAcknowledgedFingerprint, null);
});

test("regression: refresh must use current instructions in fingerprint context", () => {
  const ctxBlank = baseContext({ instructions: "" });
  const state = withGeneratedFrom(
    { ...createDefaultCaptionAssistantState(), instructions: "" },
    ctxBlank,
  );
  const afterInstructionsEdit = {
    ...state,
    instructions: "Keep the caption concise.",
  };
  const wrongContextRefresh = refreshCaptionAssistantStale(afterInstructionsEdit, ctxBlank);
  assert.equal(wrongContextRefresh.stale, false);
  const correctContextRefresh = refreshCaptionAssistantStale(
    afterInstructionsEdit,
    baseContext({ instructions: "Keep the caption concise." }),
  );
  assert.equal(correctContextRefresh.stale, true);
});

test("regression: instructions change blocks submit preflight until acknowledged", () => {
  const ctxBlank = baseContext({ instructions: "" });
  let assistant = withGeneratedFrom(
    { ...createDefaultCaptionAssistantState(), instructions: "" },
    ctxBlank,
  );
  assistant = refreshCaptionAssistantStale(
    { ...assistant, instructions: "Keep the caption concise." },
    baseContext({ instructions: "Keep the caption concise." }),
  );
  const blocked = findSubmitValidCaptionPreflightIssue([
    preflightRowWithAssistant({
      fileName: "2 - Who is Twilight Feather.png",
      shared: { body: "Generated body", cta: "CTA", instagramHashtags: ["Tag"] },
      generatedFrom: assistant.generatedFrom,
      stale: assistant.stale,
      staleAcknowledged: assistant.staleAcknowledged,
    }),
  ]);
  assert.equal(blocked?.kind, "stale_generated");

  const acknowledged = acknowledgeStaleCaption(
    assistant,
    baseContext({ instructions: "Keep the caption concise." }),
  );
  const allowed = findSubmitValidCaptionPreflightIssue([
    preflightRowWithAssistant({
      fileName: "2 - Who is Twilight Feather.png",
      shared: { body: "Generated body", cta: "CTA", instagramHashtags: ["Tag"] },
      generatedFrom: acknowledged.generatedFrom,
      stale: acknowledged.stale,
      staleAcknowledged: acknowledged.staleAcknowledged,
    }),
  ]);
  assert.equal(allowed, null);
});

test("regression: instructions change after keep-caption-anyway blocks submit again", () => {
  const ctxBlank = baseContext({ instructions: "" });
  let assistant = withGeneratedFrom(
    { ...createDefaultCaptionAssistantState(), instructions: "" },
    ctxBlank,
  );
  assistant = refreshCaptionAssistantStale(
    { ...assistant, instructions: "Keep the caption concise." },
    baseContext({ instructions: "Keep the caption concise." }),
  );
  assistant = acknowledgeStaleCaption(
    assistant,
    baseContext({ instructions: "Keep the caption concise." }),
  );
  assistant = refreshCaptionAssistantStale(
    { ...assistant, instructions: "Use a warmer tone." },
    baseContext({ instructions: "Use a warmer tone." }),
  );
  assert.equal(assistant.stale, true);
  assert.equal(assistant.staleAcknowledged, false);
  const blocked = findSubmitValidCaptionPreflightIssue([
    preflightRowWithAssistant({
      fileName: "a.png",
      shared: { body: "A", cta: "", instagramHashtags: [] },
      generatedFrom: assistant.generatedFrom,
      stale: assistant.stale,
      staleAcknowledged: assistant.staleAcknowledged,
    }),
  ]);
  assert.equal(blocked?.kind, "stale_generated");
});

test("regression: body CTA hashtag edits do not stale after generation", () => {
  const ctx = baseContext();
  let assistant = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assistant = refreshCaptionAssistantStale(
    {
      ...assistant,
      shared: {
        body: "edited",
        cta: "edited cta",
        instagramHashtags: ["Edited"],
      },
    },
    ctx,
  );
  assert.equal(assistant.stale, false);
});

test("per-platform compose keeps hashtags off Facebook", () => {
  const fb = composeFacebookCaptionPreview({ body: "FB body", cta: "" });
  const ig = composeInstagramCaptionPreview({
    body: "IG body",
    cta: "",
    instagramHashtags: ["TwilightFeather"],
  });
  assert.equal(fb, "FB body");
  assert.equal(ig, "IG body\n\n#TwilightFeather");
  assert.doesNotMatch(fb, /#/);
});

test("mode switch preserves independent drafts", () => {
  let state = createDefaultCaptionAssistantState();
  state.shared.body = "shared text";
  state.facebook.body = "fb only";
  state.instagram.body = "ig only";
  state = setCaptionAssistantMode(state, "per_platform");
  assert.equal(state.facebook.body, "fb only");
  assert.equal(state.shared.body, "shared text");
  state = setCaptionAssistantMode(state, "shared");
  assert.equal(state.shared.body, "shared text");
});

test("finalize payload per platform", () => {
  const state = createDefaultCaptionAssistantState();
  state.mode = "per_platform";
  state.facebook = { body: "FB", cta: "Shop FB" };
  state.instagram = {
    body: "IG",
    cta: "",
    instagramHashtags: ["Tag"],
  };
  const payload = buildCaptionFinalizePayload(state);
  assert.equal(payload.mode, "per_platform");
  if (payload.mode === "per_platform") {
    assert.equal(payload.facebookCaption, "FB\n\nShop FB");
    assert.equal(payload.instagramCaption, "IG\n\n#Tag");
  }
});

test("per-platform preflight requires both platforms", () => {
  const ok = findSubmitValidCaptionPreflightIssue([
    preflightRow({
      fileName: "ok.png",
      mode: "per_platform",
      facebook: { body: "F", cta: "" },
      instagram: { body: "I", cta: "", instagramHashtags: [] },
    }),
  ]);
  assert.equal(ok, null);

  const missing = findSubmitValidCaptionPreflightIssue([
    preflightRow({
      fileName: "bad.png",
      mode: "per_platform",
      facebook: { body: "F", cta: "" },
      instagram: { body: "", cta: "", instagramHashtags: [] },
    }),
  ]);
  assert.equal(missing?.kind, "missing_caption");
});

test("hasSubmittablePerPlatformCaptions", () => {
  assert.equal(
    hasSubmittablePerPlatformCaptions(
      { body: "f", cta: "" },
      { body: "i", cta: "", instagramHashtags: ["x"] },
    ),
    true,
  );
});

test("regression: book campaign category audience stale via refresh", () => {
  const ctx = baseContext();
  const assistant = withGeneratedFrom(createDefaultCaptionAssistantState(), ctx);
  assert.equal(refreshCaptionAssistantStale(assistant, baseContext({ bookId: "b1" })).stale, true);
  assert.equal(
    refreshCaptionAssistantStale(assistant, baseContext({ campaignId: "c1" })).stale,
    true,
  );
  assert.equal(
    refreshCaptionAssistantStale(assistant, {
      ...ctx,
      advanced: { category: "educational", audience: null },
    }).stale,
    true,
  );
  assert.equal(
    refreshCaptionAssistantStale(assistant, {
      ...ctx,
      advanced: { category: null, audience: "parents" },
    }).stale,
    true,
  );
});
