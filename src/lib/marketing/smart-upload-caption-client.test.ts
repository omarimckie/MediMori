import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeStaleCaption,
  buildCaptionGenerationSnapshot,
  buildCaptionInputFingerprint,
  createDefaultCaptionAssistantState,
  findSubmitValidCaptionPreflightIssue,
  hasReviewedDraftContent,
  isCaptionDraftStale,
  refreshCaptionAssistantStale,
  type CaptionFingerprintContext,
} from "./smart-upload-caption-client-state";
import {
  applyFailedCaptionGeneration,
  applySuccessfulCaptionGeneration,
  assessCaptionGenerationReadiness,
  buildGenerateCaptionsImageContextFromFile,
  buildGenerateCaptionsRequestBody,
  buildGenerationSnapshotForRequest,
  mapCaptionGenerationHttpError,
  nextCaptionGenerationRequestSeq,
  parseGenerateCaptionsResponse,
  shouldApplyCaptionGenerationResponse,
} from "./smart-upload-caption-client";

function baseContext(overrides: Partial<CaptionFingerprintContext> = {}): CaptionFingerprintContext {
  return {
    mode: "shared",
    instructions: "",
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    originalPathname: "/marketing/public/orig.png",
    originalUploadIntent: "intent.orig",
    acceptedDerivative: null,
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    finalizeKey: "fk-1",
    ...overrides,
  };
}

const imageOriginalOnly = {
  originalUploadIntent: "intent.orig",
  originalPathname: "/marketing/public/orig.png",
  finalizeKey: "fk-1",
  acceptedDerivative: null,
};

test("request: shared mode only", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.mode, "shared");
});

test("request: blank instructions omitted", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "   ",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.instructions, undefined);
});

test("request: instructions sent trimmed", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "  hello  ",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.instructions, "hello");
});

test("request: explicitCta when present", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: " Shop now ",
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.explicitCta, "Shop now");
});

test("request: no CTA omitted", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.explicitCta, undefined);
});

test("request: bookId and campaignId sent", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: "book-1",
    campaignId: "camp-1",
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.bookId, "book-1");
  assert.equal(body.campaignId, "camp-1");
});

test("request: automatic advanced omitted", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.category, undefined);
  assert.equal(body.audience, undefined);
});

test("request: category and audience overrides sent", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: "educational", audience: "parents" },
    image: imageOriginalOnly,
  });
  assert.equal(body.category, "educational");
  assert.equal(body.audience, "parents");
});

test("request: original image refs", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.originalUploadIntent, "intent.orig");
  assert.equal(body.originalPathname, "/marketing/public/orig.png");
  assert.equal(body.publicUrl, undefined);
});

test("request: derivative refs and linkage", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "shared",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: {
      ...imageOriginalOnly,
      acceptedDerivative: {
        uploadIntent: "intent.der",
        pathname: "/marketing/public/der.png",
        strategy: "crop",
        targetRatio: "1:1",
      },
    },
  });
  assert.equal(body.derivativeUploadIntent, "intent.der");
  assert.equal(body.derivativePathname, "/marketing/public/der.png");
  assert.equal(body.finalizeKey, "fk-1");
  assert.equal(body.strategy, "crop");
  assert.equal(body.targetRatio, "1:1");
});

test("success mapping applies shared draft and provenance", () => {
  const before = createDefaultCaptionAssistantState();
  before.shared = { body: "old", cta: "old cta", instagramHashtags: ["Old"] };
  const ctx = baseContext();
  const snapshot = buildGenerationSnapshotForRequest(ctx, "CTA sent");
  const response = parseGenerateCaptionsResponse({
    mode: "shared",
    shared: { body: "New body", cta: "New CTA", instagramHashtags: ["Asthma"] },
    warnings: ["warn"],
    imagePathname: "/marketing/public/orig.png",
    provider: "openai",
    model: "gpt-test",
    mock: true,
  });
  const after = applySuccessfulCaptionGeneration(before, response, snapshot);
  assert.equal(after.shared.body, "New body");
  assert.equal(after.shared.cta, "New CTA");
  assert.deepEqual(after.shared.instagramHashtags, ["Asthma"]);
  assert.deepEqual(after.warnings, ["warn"]);
  assert.equal(after.provenance?.mock, true);
  assert.equal(after.provenance?.provider, "openai");
  assert.equal(after.generatedFrom?.explicitCtaAtGeneration, "CTA sent");
  assert.equal(after.stale, false);
  assert.equal(after.staleAcknowledged, false);
  assert.equal(after.genStatus, "generated");
});

test("failure mapping preserves draft", () => {
  const before = createDefaultCaptionAssistantState();
  before.shared = { body: "keep", cta: "cta", instagramHashtags: ["Tag"] };
  const after = applyFailedCaptionGeneration(before, mapCaptionGenerationHttpError(422, "Grounding"));
  assert.equal(after.shared.body, "keep");
  assert.equal(after.genStatus, "error");
  assert.equal(after.genError, "Grounding");
});

test("http error mapping", () => {
  assert.match(mapCaptionGenerationHttpError(401, ""), /authentication/i);
  assert.match(mapCaptionGenerationHttpError(502, ""), /unavailable/i);
  assert.equal(mapCaptionGenerationHttpError(400, "bad"), "bad");
});

test("hasReviewedDraftContent drives overwrite semantics", () => {
  assert.equal(hasReviewedDraftContent({ body: "", cta: "", instagramHashtags: ["x"] }), true);
  assert.equal(hasReviewedDraftContent({ body: "", cta: "", instagramHashtags: [] }), false);
});

test("stale: instructions book campaign category audience image derivative", () => {
  const ctx = baseContext();
  const state = createDefaultCaptionAssistantState();
  state.generatedFrom = buildCaptionGenerationSnapshot(ctx, null);
  state.genStatus = "generated";

  assert.equal(isCaptionDraftStale(state, { ...ctx, instructions: "new" }), true);
  assert.equal(isCaptionDraftStale(state, { ...ctx, bookId: "b" }), true);
  assert.equal(isCaptionDraftStale(state, { ...ctx, campaignId: "c" }), true);
  assert.equal(
    isCaptionDraftStale(state, {
      ...ctx,
      advanced: { category: "educational", audience: null },
    }),
    true,
  );
  assert.equal(
    isCaptionDraftStale(state, {
      ...ctx,
      advanced: { category: null, audience: "parents" },
    }),
    true,
  );
  assert.equal(
    isCaptionDraftStale(state, { ...ctx, originalPathname: "/other.png" }),
    true,
  );
  assert.equal(
    isCaptionDraftStale(state, {
      ...ctx,
      acceptedDerivative: { pathname: "/d.png", uploadIntent: "i" },
    }),
    true,
  );
});

test("stale: body CTA hashtag edits not stale; weekly plan not in fingerprint", () => {
  const ctx = baseContext();
  const state = createDefaultCaptionAssistantState();
  state.generatedFrom = buildCaptionGenerationSnapshot(ctx, null);
  const edited = {
    ...state,
    shared: { body: "x", cta: "y", instagramHashtags: ["z"] },
  };
  assert.equal(isCaptionDraftStale(edited, ctx), false);
  const fp = buildCaptionInputFingerprint(ctx);
  assert.equal(fp.instructions, "");
});

test("acknowledge stale caption", () => {
  const ctx = baseContext();
  const state = { ...createDefaultCaptionAssistantState(), stale: true };
  const ack = acknowledgeStaleCaption(state, ctx);
  assert.equal(ack.staleAcknowledged, true);
});

test("regenerate clears stale via refresh after fingerprint match", () => {
  const ctx = baseContext({ instructions: "a" });
  let state = createDefaultCaptionAssistantState();
  state.generatedFrom = buildCaptionGenerationSnapshot(baseContext(), null);
  state = refreshCaptionAssistantStale(state, ctx);
  assert.equal(state.stale, true);
  state.generatedFrom = buildCaptionGenerationSnapshot(ctx, null);
  state = refreshCaptionAssistantStale(state, ctx);
  assert.equal(state.stale, false);
});

test("submit preflight stale unacknowledged blocks batch", () => {
  const ctx = baseContext();
  const issue = findSubmitValidCaptionPreflightIssue([
    {
      fileName: "a.png",
      status: "ready",
      uploadIntent: "i",
      acceptedDerivative: null,
      previewDerivative: null,
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
      mode: "shared",
      shared: { body: "A", cta: "", instagramHashtags: [] },
      facebook: { body: "", cta: "" },
      instagram: { body: "", cta: "", instagramHashtags: [] },
      pinterest: { title: "", description: "" },
      destinations: { facebook: true, instagram: true, pinterest: true },
      generatedFrom: buildCaptionGenerationSnapshot(ctx, null),
      stale: true,
      staleAcknowledged: false,
    },
  ]);
  assert.equal(issue?.kind, "stale_generated");
});

test("submit: manual-only and CTA-only completeness", () => {
  const missing = findSubmitValidCaptionPreflightIssue([
    {
      fileName: "a.png",
      status: "ready",
      uploadIntent: "i",
      acceptedDerivative: null,
      previewDerivative: null,
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
      mode: "shared",
      shared: { body: "", cta: "", instagramHashtags: ["only"] },
      facebook: { body: "", cta: "" },
      instagram: { body: "", cta: "", instagramHashtags: [] },
      pinterest: { title: "", description: "" },
      destinations: { facebook: true, instagram: true, pinterest: true },
      generatedFrom: null,
      stale: false,
      staleAcknowledged: false,
    },
  ]);
  assert.equal(missing?.kind, "missing_caption");

  const ctaOnly = findSubmitValidCaptionPreflightIssue([
    {
      fileName: "b.png",
      status: "ready",
      uploadIntent: "i",
      acceptedDerivative: null,
      previewDerivative: null,
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
      mode: "shared",
      shared: { body: "", cta: "Go", instagramHashtags: [] },
      facebook: { body: "", cta: "" },
      instagram: { body: "", cta: "", instagramHashtags: [] },
      pinterest: { title: "", description: "" },
      destinations: { facebook: true, instagram: true, pinterest: true },
      generatedFrom: null,
      stale: false,
      staleAcknowledged: false,
    },
  ]);
  assert.equal(ctaOnly, null);
});

test("concurrency seq helpers", () => {
  const map = new Map<string, number>();
  const a1 = nextCaptionGenerationRequestSeq(map, "file-a");
  const a2 = nextCaptionGenerationRequestSeq(map, "file-a");
  assert.equal(a1, 1);
  assert.equal(a2, 2);
  assert.equal(shouldApplyCaptionGenerationResponse(map, "file-a", 2), true);
  assert.equal(shouldApplyCaptionGenerationResponse(map, "file-a", 1), false);
});

test("readiness blocks local-multipart and needs_attention", () => {
  assert.equal(
    assessCaptionGenerationReadiness({
      status: "ready",
      uploadIntent: "local-multipart",
      pathname: "/x",
      acceptedPreview: null,
      preview: null,
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
    }).ready,
    false,
  );
  assert.equal(
    assessCaptionGenerationReadiness({
      status: "needs_attention",
      uploadIntent: "i",
      pathname: "/x",
      acceptedPreview: null,
      preview: null,
      fixStrategy: "pad",
      fixTargetRatio: "4:5",
    }).ready,
    false,
  );
});

test("request: per_platform mode", () => {
  const body = buildGenerateCaptionsRequestBody({
    mode: "per_platform",
    instructions: "",
    explicitCta: null,
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    image: imageOriginalOnly,
  });
  assert.equal(body.mode, "per_platform");
});

test("per_platform response maps to independent drafts", () => {
  const before = createDefaultCaptionAssistantState();
  before.facebook.body = "old fb";
  before.instagram.body = "old ig";
  const ctx = baseContext({ mode: "per_platform" });
  const snapshot = buildGenerationSnapshotForRequest(ctx, null);
  const response = parseGenerateCaptionsResponse({
    mode: "per_platform",
    instagram: { body: "IG new", cta: null, hashtags: ["A"] },
    facebook: { body: "FB new", cta: "CTA" },
    warnings: [],
    imagePathname: "/x",
    provider: "mock",
    mock: true,
  });
  const after = applySuccessfulCaptionGeneration(before, response, snapshot);
  assert.equal(after.mode, "per_platform");
  assert.equal(after.facebook.body, "FB new");
  assert.equal(after.facebook.cta, "CTA");
  assert.equal(after.instagram.body, "IG new");
  assert.deepEqual(after.instagram.instagramHashtags, ["A"]);
  assert.equal(after.shared.body, "");
});

test("image context builder from file", () => {
  const ctx = buildGenerateCaptionsImageContextFromFile({
    uploadIntent: "i",
    pathname: "/o.png",
    finalizeKey: "fk",
    acceptedPreview: {
      uploadIntent: "d",
      pathname: "/d.png",
      strategy: "pad",
      targetRatio: "4:5",
    },
  });
  assert.equal(ctx?.acceptedDerivative?.pathname, "/d.png");
});
