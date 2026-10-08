import assert from "node:assert/strict";
import { test } from "node:test";
import { APPROVED_CLAIMS } from "./brain";
import { SmartUploadCaptionProviderError } from "./smart-upload-caption-errors";
import {
  parseAndValidateModelPayload,
  parseUsedMedicalClaimsFromModel,
  SMART_UPLOAD_CAPTION_MAX_BODY_CHARS,
} from "./smart-upload-caption-validate";

const SICKLE_STORY = APPROVED_CLAIMS.find((c) => c.id === "sickle-cell-story")!.body;

const PIN_FIELDS = {
  pinterestTitle: "Story pin",
  pinterestDescription: "A warm invitation to read together.",
};

test("parseAndValidateModelPayload shared mode happy path", () => {
  const parsed = parseAndValidateModelPayload(
    {
      mode: "shared",
      usedMedicalClaims: [],
      sharedBody: "Hello",
      sharedCta: null,
      instagramHashtags: ["Parenting"],
      ...PIN_FIELDS,
    },
    "shared",
  );
  assert.equal(parsed.sharedBody, "Hello");
  assert.deepEqual(parsed.usedMedicalClaims, []);
});

test("wrong mode rejected", () => {
  assert.throws(
    () =>
      parseAndValidateModelPayload(
        {
          mode: "per_platform",
          usedMedicalClaims: [],
          sharedBody: "x",
          instagramHashtags: [],
          ...PIN_FIELDS,
        },
        "shared",
      ),
    SmartUploadCaptionProviderError,
  );
});

test("malformed hashtags type rejected", () => {
  assert.throws(
    () =>
      parseAndValidateModelPayload(
        {
          mode: "shared",
          usedMedicalClaims: [],
          sharedBody: "Hello",
          instagramHashtags: "not-an-array",
          ...PIN_FIELDS,
        },
        "shared",
      ),
    /must be an array/i,
  );
});

test("mixed hashtag array rejects non-string entry", () => {
  assert.throws(
    () =>
      parseAndValidateModelPayload(
        {
          mode: "shared",
          usedMedicalClaims: [],
          sharedBody: "Hello",
          instagramHashtags: ["ok", 123],
          ...PIN_FIELDS,
        },
        "shared",
      ),
    /only strings/i,
  );
});

test("huge body rejected", () => {
  assert.throws(
    () =>
      parseAndValidateModelPayload(
        {
          mode: "shared",
          usedMedicalClaims: [],
          sharedBody: "x".repeat(SMART_UPLOAD_CAPTION_MAX_BODY_CHARS + 1),
          instagramHashtags: [],
          ...PIN_FIELDS,
        },
        "shared",
      ),
    /max length/i,
  );
});

test("malformed CTA type rejected", () => {
  assert.throws(
    () =>
      parseAndValidateModelPayload(
        {
          mode: "shared",
          usedMedicalClaims: [],
          sharedBody: "Hello",
          sharedCta: { bad: true },
          instagramHashtags: [],
          ...PIN_FIELDS,
        },
        "shared",
      ),
    /must be a string or null/i,
  );
});

test("usedMedicalClaims non-array rejected", () => {
  assert.throws(() => parseUsedMedicalClaimsFromModel("bad"), /must be an array/i);
});

test("usedMedicalClaims mixed array rejected", () => {
  assert.throws(
    () => parseUsedMedicalClaimsFromModel([{ claimId: "a", text: "b" }, "x"]),
    /objects/i,
  );
});

test("usedMedicalClaims entry missing fields rejected", () => {
  assert.throws(() => parseUsedMedicalClaimsFromModel([{ claimId: "only" }]), /claimId and text/i);
});

test("excessive hashtag array rejected", () => {
  const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
  assert.throws(
    () =>
      parseAndValidateModelPayload(
        {
          mode: "shared",
          usedMedicalClaims: [],
          sharedBody: "Hello",
          instagramHashtags: tags,
          ...PIN_FIELDS,
        },
        "shared",
      ),
    /max items/i,
  );
});

test("usedMedicalClaims shape parses verbatim entries", () => {
  const parsed = parseUsedMedicalClaimsFromModel([
    { claimId: "sickle-cell-story", text: SICKLE_STORY },
  ]);
  assert.equal(parsed[0]?.claimId, "sickle-cell-story");
});
