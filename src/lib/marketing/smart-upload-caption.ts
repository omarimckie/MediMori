import { catalogBooks } from "./brain";

import type { AIProvider } from "./ai";

import { getAIProvider } from "./ai";

import { getAiComplexModel, isMockMode } from "./config";

import { scanMarketingText } from "./safety";

import type { MarketingStore } from "./store";

import type { AudienceId, ContentCategory, MarketingCampaign } from "./types";

import { AUDIENCES, CONTENT_CATEGORIES } from "./types";

import {

  buildSmartUploadCaptionPromptContext,

  boundSmartUploadCaptionInstructions,

  inferSmartUploadCaptionCategoryAndAudience,

} from "./smart-upload-caption-context";

import {

  resolveSmartUploadCaptionCta,

  sharedModeCta,

  type SmartUploadCaptionCtaPrecedenceInput,

} from "./smart-upload-caption-cta";

import {

  prepareSmartUploadModelImageInput,

  readSmartUploadCaptionImageBuffer,

} from "./smart-upload-caption-image";

import { normalizeInstagramHashtags } from "./smart-upload-caption-hashtags";

import type {

  SmartUploadCaptionGenerationResult,

  SmartUploadCaptionMode,

} from "./smart-upload-caption-types";

import { logMarketing } from "./logger";

import {
  SmartUploadCaptionGroundingError,
  SmartUploadCaptionProviderError,
} from "./smart-upload-caption-errors";
import { observeSmartUploadCaptionFailure } from "./smart-upload-incidents/observe";

import {
  assertCaptionFieldsMedicalPolicy,
  validateDeclaredUsedMedicalClaims,
} from "./smart-upload-caption-medical-grounding";
import { assertClinicalHashtagsSafe } from "./smart-upload-caption-hashtag-safety";

import {

  verifySmartUploadCaptionImageAccess,

  type SmartUploadCaptionBlobRef,

} from "./smart-upload-caption-security";

import { parseAndValidateModelPayload } from "./smart-upload-caption-validate";
import type { SmartUploadCaptionModelPayload } from "./smart-upload-caption-types";

import type { SmartUploadFixStrategy, SmartUploadFixTargetRatio } from "./smart-upload-fix";



export type SmartUploadGenerateCaptionsInput = {

  actorUsername: string | null;

  mode: SmartUploadCaptionMode;

  instructions: string | null;

  explicitCta: string | null;

  bookId: string | null;

  campaignId: string | null;

  category?: ContentCategory | null;

  audience?: AudienceId | null;

  original: SmartUploadCaptionBlobRef;

  acceptedDerivative: SmartUploadCaptionBlobRef | null;

  finalizeKey?: string | null;

  strategy?: SmartUploadFixStrategy | null;

  targetRatio?: SmartUploadFixTargetRatio | null;

  provider?: AIProvider;

};



function collectSafetyWarnings(texts: string[]): string[] {

  const warnings: string[] = [];

  for (const text of texts) {

    if (!text.trim()) continue;

    for (const flag of scanMarketingText(text)) {

      warnings.push(flag.message);

    }

  }

  return [...new Set(warnings)];

}



function buildMockModelPayload(mode: SmartUploadCaptionMode, bookId: string | null) {

  const book = bookId ? catalogBooks().find((row) => row.id === bookId) : null;

  const topic = book?.title?.replace("Children Diseases: ", "") ?? "wellness";

  const body = `A gentle moment to talk with your child about ${topic} — warmth first, story second.`;

  if (mode === "shared") {

    return {

      mode: "shared" as const,

      usedMedicalClaims: [] as { claimId: string; text: string }[],

      sharedBody: body,

      sharedCta: null,

      instagramHashtags: ["TwilightFeather", "ChildrensBooks"],

      pinterestTitle: `${topic}: a gentle story for families`,

      pinterestDescription: `${body} Save this pin for a calm way to explore ${topic} with your child.`,

    };

  }

  return {

    mode: "per_platform" as const,

    usedMedicalClaims: [] as { claimId: string; text: string }[],

    instagramBody: `${body}\n\nWhat helps your family start these conversations?`,

    instagramCta: null,

    instagramHashtags: ["TwilightFeather", "FamilyHealth"],

    facebookBody: `${body}\n\nWe would love to hear from caregivers in the comments.`,

    facebookCta: null,

    pinterestTitle: `${topic}: a gentle story for families`,

    pinterestDescription: `${body} Save this pin for a calm way to explore ${topic} with your child.`,

  };

}



function modelRequestSchema(mode: SmartUploadCaptionMode): string {

  if (mode === "shared") {

    return `{

  "mode": "shared",

  "usedMedicalClaims": [{ "claimId": "approved-claim-id", "text": "exact approved claim text" }],

  "sharedBody": "string",

  "sharedCta": "string or null",

  "instagramHashtags": ["string"],

  "pinterestTitle": "string",

  "pinterestDescription": "string"

}`;

  }

  return `{

  "mode": "per_platform",

  "usedMedicalClaims": [{ "claimId": "approved-claim-id", "text": "exact approved claim text" }],

  "instagramBody": "string",

  "instagramCta": "string or null",

  "instagramHashtags": ["string"],

  "facebookBody": "string",

  "facebookCta": "string or null",

  "pinterestTitle": "string",

  "pinterestDescription": "string"

}`;

}

export function buildSmartUploadCaptionGroundingRetryUserAppendix(groundingMessage: string): string {
  return [
    "CAPTION_GROUNDING_RETRY_INSTRUCTIONS:",
    "The prior JSON response failed medical grounding validation and must be discarded.",
    `Validation detail: ${groundingMessage}`,
    "Regenerate JSON from scratch. Every scrutinized medical sentence in sharedBody, instagramBody, facebookBody, sharedCta, instagramCta, facebookCta, pinterestTitle, and pinterestDescription must exactly match an approved claim sentence from APPROVED_CONTEXT.",
    "Do not prepend or append text in the same sentence as an approved claim. Do not paraphrase claims. If medical facts are unnecessary, use non-medical conversational copy and usedMedicalClaims: [].",
  ].join("\n");
}

function buildSmartUploadCaptionUserText(
  promptContext: ReturnType<typeof buildSmartUploadCaptionPromptContext>,
  mode: SmartUploadCaptionMode,
  groundingRetryMessage: string | null,
): string {
  const parts = [
    promptContext.userGuidanceBlock,
    "",
    "APPROVED_CONTEXT:",
    promptContext.approvedContextBlock,
    "",
    "Respond with JSON matching this schema:",
    modelRequestSchema(mode),
  ];
  if (groundingRetryMessage) {
    parts.push("", buildSmartUploadCaptionGroundingRetryUserAppendix(groundingRetryMessage));
  }
  return parts.join("\n");
}

export async function generateSmartUploadCaptions(

  store: MarketingStore,

  input: SmartUploadGenerateCaptionsInput,

): Promise<SmartUploadCaptionGenerationResult> {

  const mode = input.mode;

  const bookId = input.bookId?.trim() || null;

  if (bookId && !catalogBooks().some((book) => book.id === bookId)) {

    throw new Error("Unknown book.");

  }



  let campaign: MarketingCampaign | null = null;

  const campaignId = input.campaignId?.trim() || null;

  if (campaignId) {

    campaign = await store.getCampaign(campaignId);

    if (!campaign) throw new Error("Campaign not found.");

  }



  const { category, audience } = inferSmartUploadCaptionCategoryAndAudience({

    campaign,

    categoryOverride: input.category ?? null,

    audienceOverride: input.audience ?? null,

  });

  if (input.category && !CONTENT_CATEGORIES.includes(input.category)) {

    throw new Error("Unsupported category.");

  }

  if (input.audience && !AUDIENCES.includes(input.audience)) {

    throw new Error("Unsupported audience.");

  }



  const imageRef = verifySmartUploadCaptionImageAccess({

    actorUsername: input.actorUsername,

    original: input.original,

    acceptedDerivative: input.acceptedDerivative,

    finalizeKey: input.finalizeKey,

    strategy: input.strategy,

    targetRatio: input.targetRatio,

  });



  const buffer = await readSmartUploadCaptionImageBuffer(

    imageRef.pathname,

    imageRef.uploadIntent,

    input.actorUsername,

  );

  const modelImage = await prepareSmartUploadModelImageInput(buffer);



  const promptContext = buildSmartUploadCaptionPromptContext({

    instructions: boundSmartUploadCaptionInstructions(input.instructions),

    bookId,

    campaign,

    category,

    audience,

    mode,

  });



  const provider = input.provider ?? getAIProvider();

  const mock = provider.id === "mock" || isMockMode();

  const fallback = buildMockModelPayload(mode, bookId);



  const started = Date.now();
  const modelName = mock ? undefined : getAiComplexModel();

  function finalizeFromValidated(
    validated: SmartUploadCaptionModelPayload,
  ): SmartUploadCaptionGenerationResult {
    const declaredClaims = validateDeclaredUsedMedicalClaims(validated.usedMedicalClaims, bookId);
    assertClinicalHashtagsSafe(validated.instagramHashtags ?? []);

    const ctaBase: SmartUploadCaptionCtaPrecedenceInput = {
      explicitCta: input.explicitCta,
      campaign,
      bookId,
      modelSharedCta: validated.sharedCta ?? null,
      modelInstagramCta: validated.instagramCta ?? null,
      modelFacebookCta: validated.facebookCta ?? null,
    };

    if (mode === "shared") {
      const body = validated.sharedBody!;
      const cta = sharedModeCta(ctaBase);
      assertCaptionFieldsMedicalPolicy([body, cta], declaredClaims, bookId);
      const instagramHashtags = normalizeInstagramHashtags(validated.instagramHashtags ?? []);
      const pinterestTitle = validated.pinterestTitle;
      const pinterestDescription = validated.pinterestDescription;
      assertCaptionFieldsMedicalPolicy(
        [body, cta, pinterestTitle, pinterestDescription],
        declaredClaims,
        bookId,
      );
      const warnings = collectSafetyWarnings([body, cta ?? "", pinterestTitle, pinterestDescription]);
      return {
        mode: "shared",
        shared: { body, cta, instagramHashtags },
        pinterest: { title: pinterestTitle, description: pinterestDescription },
        warnings,
        imagePathname: imageRef.pathname,
        provider: provider.id,
        model: modelName,
        mock,
      };
    }

    const instagramBody = validated.instagramBody!;
    const facebookBody = validated.facebookBody!;
    const instagramCta = resolveSmartUploadCaptionCta(ctaBase, "instagram");
    const facebookCta = resolveSmartUploadCaptionCta(ctaBase, "facebook");
    const pinterestTitle = validated.pinterestTitle;
    const pinterestDescription = validated.pinterestDescription;
    assertCaptionFieldsMedicalPolicy(
      [instagramBody, facebookBody, instagramCta, facebookCta, pinterestTitle, pinterestDescription],
      declaredClaims,
      bookId,
    );
    const instagramHashtags = normalizeInstagramHashtags(validated.instagramHashtags ?? []);
    const warnings = collectSafetyWarnings([
      instagramBody,
      facebookBody,
      instagramCta ?? "",
      facebookCta ?? "",
      pinterestTitle,
      pinterestDescription,
    ]);
    return {
      mode: "per_platform",
      instagram: {
        body: instagramBody,
        cta: instagramCta,
        hashtags: instagramHashtags,
      },
      facebook: {
        body: facebookBody,
        cta: facebookCta,
      },
      pinterest: { title: pinterestTitle, description: pinterestDescription },
      warnings,
      imagePathname: imageRef.pathname,
      provider: provider.id,
      model: modelName,
      mock,
    };
  }

  let groundingRetryMessage: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const operation =
      attempt === 0 ? "smart_upload_generate_captions" : "smart_upload_generate_captions_grounding_retry";
    const userText = buildSmartUploadCaptionUserText(promptContext, mode, groundingRetryMessage);

    let rawUnknown: Record<string, unknown>;
    try {
      rawUnknown = await provider.generateMultimodalStructuredOutput<Record<string, unknown>>({
        task: operation,
        systemPrompt: promptContext.systemPolicy,
        userText,
        image: { mimeType: modelImage.mimeType, base64: modelImage.base64 },
        fallback,
      });
    } catch (error) {
      logMarketing({
        operation,
        provider: provider.id,
        success: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : "generation_failed",
      });
      await observeSmartUploadCaptionFailure(
        {
          finalizeKey: input.finalizeKey,
          mode: input.mode,
          sourceOperation: operation,
        },
        error,
      );
      if (error instanceof SmartUploadCaptionProviderError) throw error;
      throw error;
    }

    try {
      const validated = parseAndValidateModelPayload(rawUnknown, mode);
      const result = finalizeFromValidated(validated);
      logMarketing({
        operation,
        provider: provider.id,
        success: true,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      if (error instanceof SmartUploadCaptionGroundingError && attempt === 0) {
        groundingRetryMessage = error.message;
        continue;
      }
      logMarketing({
        operation,
        provider: provider.id,
        success: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : "generation_failed",
      });
      if (error instanceof SmartUploadCaptionGroundingError) {
        await observeSmartUploadCaptionFailure(
          {
            finalizeKey: input.finalizeKey,
            mode: input.mode,
            sourceOperation: operation,
          },
          error,
        );
      }
      throw error;
    }
  }

  throw new SmartUploadCaptionGroundingError(
    "Caption medical factual content must appear as an exact approved claim sentence.",
  );
}
