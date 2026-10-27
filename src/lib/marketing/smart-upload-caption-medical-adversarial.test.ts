import assert from "node:assert/strict";
import { test } from "node:test";
import { APPROVED_CLAIMS } from "./brain";
import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";
import { assertClinicalHashtagsSafe } from "./smart-upload-caption-hashtag-safety";
import {
  assertCaptionFieldMedicalPolicy,
  medicalSentencesToScrutinize,
  validateDeclaredUsedMedicalClaims,
} from "./smart-upload-caption-medical-grounding";

const SICKLE_STORY = APPROVED_CLAIMS.find((c) => c.id === "sickle-cell-story")!.body;
const ASTHMA_STORY = APPROVED_CLAIMS.find((c) => c.id === "asthma-story")!.body;

function declaredSickle() {
  return validateDeclaredUsedMedicalClaims([{ claimId: "sickle-cell-story", text: SICKLE_STORY }], "book-one");
}

function declaredAsthma() {
  return validateDeclaredUsedMedicalClaims([{ claimId: "asthma-story", text: ASTHMA_STORY }], "book-three");
}

function rejects(text: string, declared: ReturnType<typeof declaredSickle>, bookId: string | null) {
  assert.throws(
    () => assertCaptionFieldMedicalPolicy(text, declared, bookId),
    SmartUploadCaptionGroundingError,
  );
}

function accepts(text: string, declared: ReturnType<typeof declaredSickle>, bookId: string | null) {
  assertCaptionFieldMedicalPolicy(text, declared, bookId);
}

test("second-review false negation with claim id rejected", () => {
  rejects(
    "Sickle cell anemia never makes children strong, brave, and never alone.",
    declaredSickle(),
    "book-one",
  );
});

test("second-review cure claim rejected", () => {
  rejects("Sickle cell anemia can be cured if families read this story.", declaredSickle(), "book-one");
});

test("second-review prevention claim rejected", () => {
  rejects(
    "Sickle cell anemia prevents organ damage for brave children with kind doctors.",
    declaredSickle(),
    "book-one",
  );
});

test("second-review unsupported statistic rejected", () => {
  rejects("90% of children with sickle cell anemia are strong brave never alone.", declaredSickle(), "book-one");
});

test("second-review inheritance claim rejected", () => {
  rejects("Sickle cell disease is inherited from both parents.", [], "book-one");
});

test("second-review organ damage claim rejected", () => {
  rejects("Sickle cell disease can cause organ damage over time.", [], "book-one");
});

test("approved claim plus appended clause rejected", () => {
  rejects(`${SICKLE_STORY} and it always causes organ damage.`, declaredSickle(), "book-one");
});

test("approved claim plus preceding clause rejected", () => {
  rejects(`Always remember: ${SICKLE_STORY}`, declaredSickle(), "book-one");
});

test("which means cured appended rejected", () => {
  rejects(`${SICKLE_STORY} which means it can be cured.`, declaredSickle(), "book-one");
});

test("symptom fatigue without disease name rejected", () => {
  rejects("This can make children feel very tired.", [], "book-one");
});

test("pain crises claim rejected", () => {
  rejects("Children may experience painful crises and fatigue.", [], "book-one");
});

test("context propagation scrutinizes second sentence", () => {
  const text =
    "Sickle cell disease affects red blood cells. This can make children feel very tired.";
  const scrutiny = medicalSentencesToScrutinize(text);
  assert.equal(scrutiny[1]?.scrutinize, true);
  rejects(text, declaredSickle(), "book-one");
});

test("verbatim approved sickle claim accepted", () => {
  accepts(SICKLE_STORY, declaredSickle(), "book-one");
});

test("harmless capitalization normalization accepted", () => {
  accepts(SICKLE_STORY.toUpperCase(), declaredSickle(), "book-one");
});

test("brand non-medical copy accepted", () => {
  assertCaptionFieldMedicalPolicy(
    "A cozy reading nook moment — what stories help your family connect tonight?",
    [],
    "book-one",
  );
});

test("unsupported treatment in field rejected", () => {
  rejects("Use this treatment to prevent asthma attacks.", declaredAsthma(), "book-three");
});

test("unsafe clinical hashtags rejected", () => {
  assert.throws(
    () => assertClinicalHashtagsSafe(["AsthmaCure", "Parenting"]),
    SmartUploadCaptionGroundingError,
  );
});

test("safe neutral hashtags allowed", () => {
  assertClinicalHashtagsSafe(["ChildrensBooks", "KidsHealth", "HealthEducation"]);
});

test("cross-book declared claim rejected at validation", () => {
  assert.throws(
    () =>
      validateDeclaredUsedMedicalClaims([{ claimId: "asthma-story", text: ASTHMA_STORY }], "book-one"),
    SmartUploadCaptionGroundingError,
  );
});

test("paraphrased claim text rejected at declaration", () => {
  assert.throws(
    () =>
      validateDeclaredUsedMedicalClaims(
        [{ claimId: "sickle-cell-story", text: "Amara has sickle cell and is brave." }],
        "book-one",
      ),
    SmartUploadCaptionGroundingError,
  );
});
