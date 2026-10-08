import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCaptionGenerationSnapshot } from "./smart-upload-caption-client-state";
import type { SubmitValidCaptionPreflightEntry } from "./smart-upload-caption-client-state";
import {
  formatStaleCaptionSubmitPreflightMessage,
  isStaleCaptionSubmitPreflightMessage,
  reconcileStaleCaptionSubmitSessionMessage,
} from "./smart-upload-caption-submit-message";

function row(
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
    shared: { body: "A", cta: "", instagramHashtags: [] },
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

const ctxSnapshot = buildCaptionGenerationSnapshot(
  {
    mode: "shared",
    instructions: "",
    bookId: null,
    campaignId: null,
    advanced: { category: null, audience: null },
    originalPathname: "marketing/public/a.png",
    originalUploadIntent: "intent",
    acceptedDerivative: null,
    fixStrategy: "pad",
    fixTargetRatio: "4:5",
    finalizeKey: "fk",
  },
  null,
);

test("1: stale submit preflight message is typed and recognized", () => {
  const msg = formatStaleCaptionSubmitPreflightMessage("2 - Who is Twilight Feather.png");
  assert.equal(isStaleCaptionSubmitPreflightMessage(msg), true);
  const entries = [
    row({
      fileName: "2 - Who is Twilight Feather.png",
      generatedFrom: ctxSnapshot,
      stale: true,
      staleAcknowledged: false,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(msg, entries), msg);
});

test("2: successful regeneration clears stale-submit error when no longer stale", () => {
  const msg = formatStaleCaptionSubmitPreflightMessage("a.png");
  const entries = [
    row({
      fileName: "a.png",
      generatedFrom: ctxSnapshot,
      stale: false,
      staleAcknowledged: false,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(msg, entries), null);
});

test("3: Keep Caption Anyway clears stale-submit error when acknowledged", () => {
  const msg = formatStaleCaptionSubmitPreflightMessage("a.png");
  const entries = [
    row({
      fileName: "a.png",
      generatedFrom: ctxSnapshot,
      stale: true,
      staleAcknowledged: true,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(msg, entries), null);
});

test("4: unrelated error is NOT cleared by regeneration reconciliation", () => {
  const unrelated = 'Caption or CTA is required for "b.png" before submitting.';
  assert.equal(isStaleCaptionSubmitPreflightMessage(unrelated), false);
  const entries = [
    row({
      fileName: "a.png",
      generatedFrom: ctxSnapshot,
      stale: false,
      staleAcknowledged: false,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(unrelated, entries), unrelated);
});

test("5: unrelated error is NOT cleared by Keep Caption Anyway reconciliation", () => {
  const unrelated = "Upload or validation failed.";
  const entries = [
    row({
      fileName: "a.png",
      generatedFrom: ctxSnapshot,
      stale: true,
      staleAcknowledged: true,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(unrelated, entries), unrelated);
});

test("6: changing generation input after resolution does not resurrect old error", () => {
  const msg = formatStaleCaptionSubmitPreflightMessage("a.png");
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(msg, [row({ fileName: "a.png", stale: false })]), null);
  const staleAgain = [
    row({
      fileName: "a.png",
      generatedFrom: ctxSnapshot,
      stale: true,
      staleAcknowledged: false,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(null, staleAgain), null);
});

test("7: next stale submit keeps message until reconciled after fix", () => {
  const msg = formatStaleCaptionSubmitPreflightMessage("a.png");
  const stale = [
    row({
      fileName: "a.png",
      generatedFrom: ctxSnapshot,
      stale: true,
      staleAcknowledged: false,
    }),
  ];
  assert.equal(reconcileStaleCaptionSubmitSessionMessage(msg, stale), msg);
  assert.equal(
    reconcileStaleCaptionSubmitSessionMessage(msg, [
      row({ fileName: "a.png", generatedFrom: ctxSnapshot, stale: true, staleAcknowledged: true }),
    ]),
    null,
  );
});
