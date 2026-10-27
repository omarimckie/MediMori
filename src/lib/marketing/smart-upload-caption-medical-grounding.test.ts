import assert from "node:assert/strict";
import { test } from "node:test";
import { APPROVED_CLAIMS } from "./brain";
import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";
import {
  allowedApprovedClaimIdsForBook,
  assertCaptionFieldMedicalPolicy,
  scrutinizedMedicalSentences,
  validateDeclaredUsedMedicalClaims,
} from "./smart-upload-caption-medical-grounding";

const SICKLE_STORY = APPROVED_CLAIMS.find((c) => c.id === "sickle-cell-story")!.body;

test("unsupported organ damage rejected without declared claims", () => {
  const text = "Sickle cell disease can cause organ damage over time.";
  assert.ok(scrutinizedMedicalSentences(text).length > 0);
  assert.throws(
    () => assertCaptionFieldMedicalPolicy(text, [], "book-one"),
    SmartUploadCaptionGroundingError,
  );
});

test("verbatim approved sickle cell story accepted", () => {
  const declared = validateDeclaredUsedMedicalClaims(
    [{ claimId: "sickle-cell-story", text: SICKLE_STORY }],
    "book-one",
  );
  assertCaptionFieldMedicalPolicy(SICKLE_STORY, declared, "book-one");
});

test("unknown claim id rejected at declaration", () => {
  assert.throws(
    () =>
      validateDeclaredUsedMedicalClaims([{ claimId: "not-a-real-claim", text: "x" }], "book-one"),
    /not allowed/i,
  );
});

test("cross-book asthma claim id rejected for sickle cell book", () => {
  const asthma = APPROVED_CLAIMS.find((c) => c.id === "asthma-story")!.body;
  assert.throws(
    () => validateDeclaredUsedMedicalClaims([{ claimId: "asthma-story", text: asthma }], "book-one"),
    SmartUploadCaptionGroundingError,
  );
});

test("no-book substantive medical claim rejected", () => {
  assert.throws(
    () =>
      assertCaptionFieldMedicalPolicy(
        "Asthma medications should be adjusted without a doctor.",
        [],
        null,
      ),
    SmartUploadCaptionGroundingError,
  );
});

test("brand copy without medical facts passes", () => {
  assertCaptionFieldMedicalPolicy(
    "A cozy reading nook moment — what stories help your family connect tonight?",
    [],
    "book-one",
  );
});

test("book-one cannot access asthma-only claim ids", () => {
  const allowed = allowedApprovedClaimIdsForBook("book-one");
  assert.ok(allowed.has("sickle-cell-story"));
  assert.equal(allowed.has("asthma-story"), false);
});

test("invented statistic requires declared verbatim claims", () => {
  assert.throws(
    () => assertCaptionFieldMedicalPolicy("Studies show 50% of children improve.", [], null),
    SmartUploadCaptionGroundingError,
  );
});

test("treatment recommendation rejected without approved claims", () => {
  assert.throws(
    () =>
      assertCaptionFieldMedicalPolicy("You should take this medication daily.", [], "book-three"),
    SmartUploadCaptionGroundingError,
  );
});
