import assert from "node:assert/strict";

import { test } from "node:test";

import {

  parseSmartUploadGenerateCaptionsBody,

  smartUploadCaptionErrorStatus,

} from "./smart-upload-caption-api";

import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";

import { SmartUploadCaptionProviderError } from "./smart-upload-caption-errors";



test("parseSmartUploadGenerateCaptionsBody accepts original refs without publicUrl", () => {

  const parsed = parseSmartUploadGenerateCaptionsBody({

    mode: "shared",

    uploadIntent: "a.b",

    pathname: `marketing/public/${"c".repeat(32)}.png`,

  });

  assert.equal(parsed.mode, "shared");

  assert.equal(parsed.original.uploadIntent, "a.b");

});



test("parseSmartUploadGenerateCaptionsBody rejects partial derivative refs", () => {

  assert.throws(

    () =>

      parseSmartUploadGenerateCaptionsBody({

        mode: "shared",

        uploadIntent: "a.b",

        pathname: `marketing/public/${"c".repeat(32)}.png`,

        derivativeUploadIntent: "d.e",

      }),

    /required together/i,

  );

});



test("parseSmartUploadGenerateCaptionsBody requires finalize linkage with derivative", () => {
  assert.throws(
    () =>
      parseSmartUploadGenerateCaptionsBody({
        mode: "shared",
        uploadIntent: "a.b",
        pathname: `marketing/public/${"c".repeat(32)}.png`,
        derivativeUploadIntent: "d.e",
        derivativePathname: `marketing/public/${"d".repeat(32)}.png`,
      }),
    /finalizeKey, strategy, and targetRatio/i,
  );
});

test("parseSmartUploadGenerateCaptionsBody accepts derivative without publicUrl", () => {

  const parsed = parseSmartUploadGenerateCaptionsBody({

    mode: "shared",

    uploadIntent: "a.b",

    pathname: `marketing/public/${"c".repeat(32)}.png`,

    derivativeUploadIntent: "d.e",

    derivativePathname: `marketing/public/${"d".repeat(32)}.png`,

    finalizeKey: "fk",

    strategy: "pad",

    targetRatio: "4:5",

  });

  assert.ok(parsed.acceptedDerivative);

  assert.equal(parsed.acceptedDerivative?.pathname, `marketing/public/${"d".repeat(32)}.png`);

});



test("smartUploadCaptionErrorStatus maps timeout to 502", () => {

  assert.equal(smartUploadCaptionErrorStatus("OpenAI multimodal request timed out."), 502);

});



test("smartUploadCaptionErrorStatus maps grounding to 422", () => {

  assert.equal(

    smartUploadCaptionErrorStatus(new SmartUploadCaptionGroundingError("not grounded")),

    422,

  );

});



test("smartUploadCaptionErrorStatus maps malformed model output to 502", () => {

  assert.equal(

    smartUploadCaptionErrorStatus(new SmartUploadCaptionProviderError("Caption model response bad")),

    502,

  );

});



test("smartUploadCaptionErrorStatus maps client validation to 400", () => {

  assert.equal(smartUploadCaptionErrorStatus(new Error("Unknown book.")), 400);

});



test("smartUploadCaptionErrorStatus does not map generic JSON text to 400", () => {

  assert.equal(smartUploadCaptionErrorStatus(new Error("OpenAI multimodal response was not valid JSON.")), 502);

});
