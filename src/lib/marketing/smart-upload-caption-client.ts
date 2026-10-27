import type { SmartUploadCaptionGenerationResult } from "./smart-upload-caption-types";
import { resourceBlobStorageUnavailableMessage } from "./resource-multipart-fallback";
import {
  buildCaptionGenerationSnapshot,
  type CaptionAssistantAdvanced,
  type CaptionAssistantState,
  type CaptionFingerprintContext,
  type CaptionGenerationSnapshot,
} from "./smart-upload-caption-client-state";

export const GENERATE_CAPTIONS_URL = "/api/admin/marketing/smart-upload/generate-captions";

export const CAPTION_CLIENT_INSTRUCTIONS_MAX_LENGTH = 2_000;

export type GenerateCaptionsImageContext = {
  originalUploadIntent: string;
  originalPathname: string;
  acceptedDerivative: {
    uploadIntent: string;
    pathname: string;
    strategy: string;
    targetRatio: string;
  } | null;
  finalizeKey: string;
};

export type BuildGenerateCaptionsRequestInput = {
  mode: "shared" | "per_platform";
  instructions: string;
  explicitCta: string | null;
  bookId: string | null;
  campaignId: string | null;
  advanced: CaptionAssistantAdvanced;
  image: GenerateCaptionsImageContext;
};

export function buildGenerateCaptionsRequestBody(
  input: BuildGenerateCaptionsRequestInput,
): Record<string, unknown> {
  const instructions = input.instructions.trim().slice(0, CAPTION_CLIENT_INSTRUCTIONS_MAX_LENGTH);
  const explicitCta = input.explicitCta?.trim() || null;

  const body: Record<string, unknown> = {
    mode: input.mode,
    originalUploadIntent: input.image.originalUploadIntent,
    originalPathname: input.image.originalPathname,
  };

  if (instructions) body.instructions = instructions;
  if (explicitCta) body.explicitCta = explicitCta;
  if (input.bookId?.trim()) body.bookId = input.bookId.trim();
  if (input.campaignId?.trim()) body.campaignId = input.campaignId.trim();
  if (input.advanced.category) body.category = input.advanced.category;
  if (input.advanced.audience) body.audience = input.advanced.audience;

  const derivative = input.image.acceptedDerivative;
  if (derivative) {
    body.derivativeUploadIntent = derivative.uploadIntent;
    body.derivativePathname = derivative.pathname;
    body.finalizeKey = input.image.finalizeKey;
    body.strategy = derivative.strategy;
    body.targetRatio = derivative.targetRatio;
  }

  return body;
}

export function mapCaptionGenerationHttpError(status: number, serverMessage: string): string {
  if (status === 401) {
    return "Admin authentication is required. Sign in and try again.";
  }
  if (status === 404) {
    return serverMessage.trim() || "Campaign not found.";
  }
  if (status === 422) {
    return (
      serverMessage.trim() ||
      "Caption could not satisfy approved marketing and medical grounding. Adjust instructions or context and try again."
    );
  }
  if (status === 502) {
    return "Caption service unavailable. Try again.";
  }
  if (status === 400) {
    return serverMessage.trim() || "Image or request was invalid. Re-validate the upload and try again.";
  }
  return serverMessage.trim() || "Caption generation failed. Try again.";
}

function parsePlatformDraftFromResponse(
  raw: Record<string, unknown> | undefined,
  includeHashtags: boolean,
): { body: string; cta: string | null; hashtags: string[] } {
  if (!raw) {
    throw new Error("Expected platform caption in generation response.");
  }
  const hashtags =
    includeHashtags && Array.isArray(raw.hashtags)
      ? raw.hashtags.map((tag) => String(tag))
      : includeHashtags && Array.isArray(raw.instagramHashtags)
        ? raw.instagramHashtags.map((tag) => String(tag))
        : [];
  return {
    body: String(raw.body ?? ""),
    cta: raw.cta == null ? null : String(raw.cta),
    hashtags,
  };
}

export function parseGenerateCaptionsResponse(
  payload: Record<string, unknown>,
): SmartUploadCaptionGenerationResult {
  const mode = payload.mode === "per_platform" ? "per_platform" : "shared";
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((w) => String(w))
    : [];
  const pinterestRaw = payload.pinterest as Record<string, unknown> | undefined;
  const pinterest = {
    title: String(pinterestRaw?.title ?? ""),
    description: String(pinterestRaw?.description ?? ""),
  };

  const base = {
    warnings,
    imagePathname: String(payload.imagePathname ?? ""),
    provider: String(payload.provider ?? ""),
    model: payload.model == null ? undefined : String(payload.model),
    mock: Boolean(payload.mock),
    pinterest,
  };

  if (mode === "per_platform") {
    const instagramRaw = payload.instagram as Record<string, unknown> | undefined;
    const facebookRaw = payload.facebook as Record<string, unknown> | undefined;
    const instagram = parsePlatformDraftFromResponse(instagramRaw, true);
    const facebook = parsePlatformDraftFromResponse(facebookRaw, false);
    return {
      mode: "per_platform",
      instagram: {
        body: instagram.body,
        cta: instagram.cta,
        hashtags: instagram.hashtags,
      },
      facebook: {
        body: facebook.body,
        cta: facebook.cta,
      },
      ...base,
    };
  }

  const sharedRaw = payload.shared as Record<string, unknown> | undefined;
  if (!sharedRaw) {
    throw new Error("Expected shared caption generation response.");
  }
  const instagramHashtags = Array.isArray(sharedRaw.instagramHashtags)
    ? sharedRaw.instagramHashtags.map((tag) => String(tag))
    : [];
  const shared = {
    body: String(sharedRaw.body ?? ""),
    cta: sharedRaw.cta == null ? null : String(sharedRaw.cta),
    instagramHashtags,
  };
  return {
    mode: "shared",
    shared,
    ...base,
  };
}

export function applySuccessfulCaptionGeneration(
  state: CaptionAssistantState,
  response: SmartUploadCaptionGenerationResult,
  snapshot: CaptionGenerationSnapshot,
): CaptionAssistantState {
  const provenanceBlock = {
    genStatus: "generated" as const,
    genError: null,
    warnings: response.warnings,
    provenance: {
      provider: response.provider,
      model: response.model,
      mock: response.mock,
      imagePathname: response.imagePathname,
    },
    generatedFrom: snapshot,
    stale: false,
    staleAcknowledged: false,
    staleAcknowledgedFingerprint: null,
  };

  if (response.mode === "per_platform") {
    if (!response.instagram || !response.facebook) {
      throw new Error("Missing per-platform caption in generation response.");
    }
    return {
      ...state,
      mode: "per_platform",
      ...provenanceBlock,
      instagram: {
        body: response.instagram.body,
        cta: response.instagram.cta ?? "",
        instagramHashtags: [...(response.instagram.hashtags ?? [])],
      },
      facebook: {
        body: response.facebook.body,
        cta: response.facebook.cta ?? "",
      },
      pinterest: {
        title: response.pinterest.title,
        description: response.pinterest.description,
      },
    };
  }

  if (!response.shared) {
    throw new Error("Missing shared caption in generation response.");
  }
  return {
    ...state,
    mode: "shared",
    ...provenanceBlock,
    shared: {
      body: response.shared.body,
      cta: response.shared.cta ?? "",
      instagramHashtags: [...response.shared.instagramHashtags],
    },
    pinterest: {
      title: response.pinterest.title,
      description: response.pinterest.description,
    },
  };
}

export function applyFailedCaptionGeneration(
  state: CaptionAssistantState,
  message: string,
): CaptionAssistantState {
  return {
    ...state,
    genStatus: "error",
    genError: message,
  };
}

export function beginCaptionGeneration(state: CaptionAssistantState): CaptionAssistantState {
  return {
    ...state,
    genStatus: "generating",
    genError: null,
  };
}

export function buildGenerationSnapshotForRequest(
  context: CaptionFingerprintContext,
  explicitCta: string | null,
): CaptionGenerationSnapshot {
  return buildCaptionGenerationSnapshot(context, explicitCta);
}

export type CaptionGenerationReadiness = { ready: true } | { ready: false; reason: string };

export function assessCaptionGenerationReadiness(input: {
  status: string;
  uploadIntent: string | null;
  pathname: string | null;
  acceptedPreview: { strategy: string; targetRatio: string } | null;
  preview: { strategy: string; targetRatio: string } | null;
  fixStrategy: string;
  fixTargetRatio: string;
}): CaptionGenerationReadiness {
  if (input.uploadIntent === "local-multipart") {
    return { ready: false, reason: resourceBlobStorageUnavailableMessage() };
  }
  if (input.status === "needs_attention") {
    return { ready: false, reason: "Fix image validation issues before generating a caption." };
  }
  if (input.status === "failed") {
    return { ready: false, reason: "Re-upload and validate this image before generating." };
  }
  if (input.status === "submitted") {
    return { ready: false, reason: "This image was already submitted." };
  }
  if (input.acceptedPreview && input.preview) {
    if (
      input.preview.strategy !== input.fixStrategy ||
      input.preview.targetRatio !== input.fixTargetRatio
    ) {
      return {
        ready: false,
        reason: "Accept the corrected preview that matches your fix settings.",
      };
    }
  }
  if (!input.uploadIntent || !input.pathname) {
    return {
      ready: false,
      reason: "Upload and validate this image before generating a caption.",
    };
  }
  if (input.status !== "ready") {
    return { ready: false, reason: "Image must be validated before generating a caption." };
  }
  return { ready: true };
}

export function buildGenerateCaptionsImageContextFromFile(input: {
  uploadIntent: string | null;
  pathname: string | null;
  finalizeKey: string;
  acceptedPreview: {
    uploadIntent: string;
    pathname: string;
    strategy: string;
    targetRatio: string;
  } | null;
}): GenerateCaptionsImageContext | null {
  if (!input.uploadIntent?.trim() || !input.pathname?.trim()) return null;
  const derivative = input.acceptedPreview;
  return {
    originalUploadIntent: input.uploadIntent.trim(),
    originalPathname: input.pathname.trim(),
    finalizeKey: input.finalizeKey.trim(),
    acceptedDerivative: derivative
      ? {
          uploadIntent: derivative.uploadIntent.trim(),
          pathname: derivative.pathname.trim(),
          strategy: derivative.strategy,
          targetRatio: derivative.targetRatio,
        }
      : null,
  };
}

export function nextCaptionGenerationRequestSeq(
  seqByFileId: Map<string, number>,
  fileId: string,
): number {
  const next = (seqByFileId.get(fileId) ?? 0) + 1;
  seqByFileId.set(fileId, next);
  return next;
}

export function shouldApplyCaptionGenerationResponse(
  seqByFileId: Map<string, number>,
  fileId: string,
  requestSeq: number,
): boolean {
  return seqByFileId.get(fileId) === requestSeq;
}
