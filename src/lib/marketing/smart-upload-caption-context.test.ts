import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundSmartUploadCaptionInstructions,
  buildSmartUploadCaptionPromptContext,
  inferSmartUploadCaptionCategoryAndAudience,
  promptContextExcludesUnapprovedBookMedicalText,
  SMART_UPLOAD_CAPTION_INSTRUCTIONS_MAX_LENGTH,
} from "./smart-upload-caption-context";
import type { MarketingCampaign } from "./types";

test("buildSmartUploadCaptionPromptContext includes brand and approved claims", () => {
  const ctx = buildSmartUploadCaptionPromptContext({
    instructions: "Keep it warm",
    bookId: "book-one",
    campaign: null,
    category: "educational",
    audience: "parents",
    mode: "shared",
  });
  assert.match(ctx.systemPolicy, /descriptive context only/i);
  assert.match(ctx.approvedContextBlock, /Twilight Feather/);
  assert.match(ctx.approvedContextBlock, /Sickle Cell/);
  assert.match(ctx.userGuidanceBlock, /Keep it warm/);
  assert.ok(promptContextExcludesUnapprovedBookMedicalText(ctx));
});

test("instructions are bounded", () => {
  const long = "x".repeat(SMART_UPLOAD_CAPTION_INSTRUCTIONS_MAX_LENGTH + 50);
  assert.equal(
    boundSmartUploadCaptionInstructions(long).length,
    SMART_UPLOAD_CAPTION_INSTRUCTIONS_MAX_LENGTH,
  );
});

test("infer category and audience defaults", () => {
  const campaign: MarketingCampaign = {
    id: "c",
    name: "n",
    objective: "o",
    status: "active",
    primaryAudience: "schools",
    secondaryAudience: null,
    coreMessage: "m",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta: null,
    requiredAssets: [],
    measurementGoals: [],
    bookIds: [],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const inferred = inferSmartUploadCaptionCategoryAndAudience({ campaign });
  assert.equal(inferred.category, "educational");
  assert.equal(inferred.audience, "schools");
});
