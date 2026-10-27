import type { SmartUploadDestinations } from "./smart-upload-destinations";
import { metaDestinationsSelected } from "./smart-upload-destinations";
import type { AudienceId, ContentCategory } from "./types";
import { AUDIENCES, CONTENT_CATEGORIES } from "./types";

export type CaptionAssistantMode = "shared" | "per_platform";

export type CaptionAssistantDraft = {
  body: string;
  cta: string;
  instagramHashtags: string[];
};

/** Facebook-only draft (no Instagram hashtags). */
export type CaptionAssistantFacebookDraft = {
  body: string;
  cta: string;
};

/** Instagram draft with optional hashtag list appended on compose. */
export type CaptionAssistantInstagramDraft = {
  body: string;
  cta: string;
  instagramHashtags: string[];
};

export type CaptionAssistantAdvanced = {
  category: ContentCategory | null;
  audience: AudienceId | null;
};

export type CaptionAssistantGenStatus = "idle" | "generating" | "generated" | "error";

export type CaptionAssistantProvenance = {
  provider: string;
  model?: string;
  mock: boolean;
  imagePathname: string;
};

/** Serializable fingerprint of inputs that affect caption generation (not reviewed draft edits). */
export type CaptionInputFingerprint = {
  mode: CaptionAssistantMode;
  instructions: string;
  bookId: string | null;
  campaignId: string | null;
  category: ContentCategory | null;
  audience: AudienceId | null;
  originalPathname: string;
  originalUploadIntent: string;
  derivativePathname: string | null;
  derivativeUploadIntent: string | null;
  strategy: string | null;
  targetRatio: string | null;
  finalizeKey: string;
};

export type CaptionGenerationSnapshot = {
  fingerprint: CaptionInputFingerprint;
  explicitCtaAtGeneration: string | null;
};

export type CaptionFingerprintContext = {
  mode: CaptionAssistantMode;
  instructions: string;
  bookId: string | null;
  campaignId: string | null;
  advanced: CaptionAssistantAdvanced;
  originalPathname: string | null;
  originalUploadIntent: string | null;
  acceptedDerivative: { pathname: string; uploadIntent: string } | null;
  fixStrategy: "pad" | "crop";
  fixTargetRatio: "4:5" | "1:1" | "2:3";
  finalizeKey: string;
};

/** Per-file caption assistant state (shared mode UI in Phase 4B; per_platform reserved for 4C). */
export type CaptionAssistantPinterestDraft = {
  title: string;
  description: string;
};

export type CaptionAssistantState = {
  mode: CaptionAssistantMode;
  instructions: string;
  advanced: CaptionAssistantAdvanced;
  genStatus: CaptionAssistantGenStatus;
  genError: string | null;
  warnings: string[];
  provenance: CaptionAssistantProvenance | null;
  /** Inputs used for the last successful generation (explicit CTA sent is stored but not used for stale-on-CTA-edit). */
  generatedFrom: CaptionGenerationSnapshot | null;
  stale: boolean;
  staleAcknowledged: boolean;
  /** Generation-input fingerprint the user acknowledged via Keep Caption Anyway (if any). */
  staleAcknowledgedFingerprint: CaptionInputFingerprint | null;
  shared: CaptionAssistantDraft;
  facebook: CaptionAssistantFacebookDraft;
  instagram: CaptionAssistantInstagramDraft;
  pinterest: CaptionAssistantPinterestDraft;
};

export function createDefaultCaptionAssistantState(): CaptionAssistantState {
  return {
    mode: "shared",
    instructions: "",
    advanced: { category: null, audience: null },
    genStatus: "idle",
    genError: null,
    warnings: [],
    provenance: null,
    generatedFrom: null,
    stale: false,
    staleAcknowledged: false,
    staleAcknowledgedFingerprint: null,
    shared: { body: "", cta: "", instagramHashtags: [] },
    facebook: { body: "", cta: "" },
    instagram: { body: "", cta: "", instagramHashtags: [] },
    pinterest: { title: "", description: "" },
  };
}

export function createEmptyFacebookDraft(): CaptionAssistantFacebookDraft {
  return { body: "", cta: "" };
}

export function createEmptyInstagramDraft(): CaptionAssistantInstagramDraft {
  return { body: "", cta: "", instagramHashtags: [] };
}

function normalizeInstructions(value: string): string {
  return value.trim();
}

function fingerprintKeyOrder(): (keyof CaptionInputFingerprint)[] {
  return [
    "mode",
    "instructions",
    "bookId",
    "campaignId",
    "category",
    "audience",
    "originalPathname",
    "originalUploadIntent",
    "derivativePathname",
    "derivativeUploadIntent",
    "strategy",
    "targetRatio",
    "finalizeKey",
  ];
}

export function serializeCaptionInputFingerprint(fp: CaptionInputFingerprint): string {
  const ordered: Record<string, unknown> = {};
  for (const key of fingerprintKeyOrder()) {
    ordered[key] = fp[key];
  }
  return JSON.stringify(ordered);
}

export function captionInputFingerprintsEqual(
  a: CaptionInputFingerprint,
  b: CaptionInputFingerprint,
): boolean {
  return serializeCaptionInputFingerprint(a) === serializeCaptionInputFingerprint(b);
}

export function buildCaptionInputFingerprint(context: CaptionFingerprintContext): CaptionInputFingerprint {
  const derivative = context.acceptedDerivative;
  return {
    mode: context.mode,
    instructions: normalizeInstructions(context.instructions),
    bookId: context.bookId?.trim() || null,
    campaignId: context.campaignId?.trim() || null,
    category: context.advanced.category,
    audience: context.advanced.audience,
    originalPathname: context.originalPathname?.trim() || "",
    originalUploadIntent: context.originalUploadIntent?.trim() || "",
    derivativePathname: derivative?.pathname.trim() || null,
    derivativeUploadIntent: derivative?.uploadIntent.trim() || null,
    strategy: derivative ? context.fixStrategy : null,
    targetRatio: derivative ? context.fixTargetRatio : null,
    finalizeKey: context.finalizeKey.trim(),
  };
}

export function buildCaptionGenerationSnapshot(
  context: CaptionFingerprintContext,
  explicitCtaAtGeneration: string | null,
): CaptionGenerationSnapshot {
  const cta = explicitCtaAtGeneration?.trim() || null;
  return {
    fingerprint: buildCaptionInputFingerprint(context),
    explicitCtaAtGeneration: cta,
  };
}

export function isCaptionDraftStale(
  state: CaptionAssistantState,
  context: CaptionFingerprintContext,
): boolean {
  if (!state.generatedFrom) return false;
  const current = buildCaptionInputFingerprint(context);
  return !captionInputFingerprintsEqual(current, state.generatedFrom.fingerprint);
}

/** Meaningful user-edited draft; overwrite confirmation required before generation. */
export function hasReviewedDraftContent(draft: CaptionAssistantDraft): boolean {
  return Boolean(
    draft.body.trim() || draft.cta.trim() || draft.instagramHashtags.length > 0,
  );
}

export function hasReviewedFacebookDraft(draft: CaptionAssistantFacebookDraft): boolean {
  return Boolean(draft.body.trim() || draft.cta.trim());
}

export function hasReviewedInstagramDraft(draft: CaptionAssistantInstagramDraft): boolean {
  return Boolean(
    draft.body.trim() || draft.cta.trim() || draft.instagramHashtags.length > 0,
  );
}

export function hasReviewedDraftContentForMode(state: CaptionAssistantState): boolean {
  if (state.mode === "per_platform") {
    return hasReviewedFacebookDraft(state.facebook) || hasReviewedInstagramDraft(state.instagram);
  }
  return hasReviewedDraftContent(state.shared);
}

/**
 * Switch caption mode without discarding drafts stored for the other mode.
 * Clears stale acknowledgment because generation fingerprint mode changed.
 */
export function setCaptionAssistantMode(
  state: CaptionAssistantState,
  mode: CaptionAssistantMode,
): CaptionAssistantState {
  if (state.mode === mode) return state;
  return {
    ...state,
    mode,
    staleAcknowledged: false,
    staleAcknowledgedFingerprint: null,
  };
}

export function acknowledgeStaleCaption(
  state: CaptionAssistantState,
  context: CaptionFingerprintContext,
): CaptionAssistantState {
  if (!state.stale) return state;
  return {
    ...state,
    staleAcknowledged: true,
    staleAcknowledgedFingerprint: buildCaptionInputFingerprint(context),
  };
}

/** Recompute stale flag when generation inputs or image identity change (no fetch). */
export function refreshCaptionAssistantStale(
  state: CaptionAssistantState,
  context: CaptionFingerprintContext,
): CaptionAssistantState {
  if (!state.generatedFrom) {
    return state.stale || state.staleAcknowledged || state.staleAcknowledgedFingerprint
      ? {
          ...state,
          stale: false,
          staleAcknowledged: false,
          staleAcknowledgedFingerprint: null,
        }
      : state;
  }
  const stale = isCaptionDraftStale(state, context);
  if (!stale) {
    return {
      ...state,
      stale: false,
      staleAcknowledged: false,
      staleAcknowledgedFingerprint: null,
    };
  }
  const currentFingerprint = buildCaptionInputFingerprint(context);
  const acknowledgmentStillValid =
    state.staleAcknowledged &&
    state.staleAcknowledgedFingerprint !== null &&
    captionInputFingerprintsEqual(currentFingerprint, state.staleAcknowledgedFingerprint);
  return {
    ...state,
    stale: true,
    staleAcknowledged: acknowledgmentStillValid,
    staleAcknowledgedFingerprint: acknowledgmentStillValid
      ? state.staleAcknowledgedFingerprint
      : null,
  };
}

export function parseHashtagInput(raw: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const core = part.replace(/^#+/, "").trim();
    if (!core) continue;
    const key = core.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(core);
  }
  return tags;
}

export function formatHashtagInput(tags: string[]): string {
  return tags.join(" ");
}

export function formatHashtagsForPreview(tags: string[]): string {
  return tags
    .map((tag) => {
      const core = tag.replace(/^#+/, "").trim();
      return core ? `#${core}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** Submit Valid preflight: body or CTA required; hashtags alone do not count. */
export function hasSubmittableSharedCaption(draft: CaptionAssistantDraft): boolean {
  return Boolean(draft.body.trim() || draft.cta.trim());
}

export type SubmitValidCaptionPreflightEntry = {
  fileName: string;
  status: string;
  uploadIntent: string | null;
  acceptedDerivative: { strategy: string; targetRatio: string } | null;
  previewDerivative: { strategy: string; targetRatio: string } | null;
  fixStrategy: string;
  fixTargetRatio: string;
  mode: CaptionAssistantMode;
  shared: CaptionAssistantDraft;
  facebook: CaptionAssistantFacebookDraft;
  instagram: CaptionAssistantInstagramDraft;
  pinterest: CaptionAssistantPinterestDraft;
  destinations: SmartUploadDestinations;
  generatedFrom: CaptionGenerationSnapshot | null;
  stale: boolean;
  staleAcknowledged: boolean;
};

export type SubmitValidCaptionPreflightIssue =
  | { kind: "missing_caption"; fileName: string }
  | { kind: "stale_generated"; fileName: string };

/**
 * Whether this file is in scope for caption preflight on Submit Valid.
 * Aligns with rows the submit loop can finalize (ready, not failed/needs_attention/submitted,
 * and accepted preview settings match when a corrected image is in use).
 */
export function isSubmitValidCaptionPreflightTarget(
  entry: Omit<SubmitValidCaptionPreflightEntry, "fileName" | "shared">,
): boolean {
  if (
    entry.status === "submitted" ||
    entry.status === "needs_attention" ||
    entry.status === "failed"
  ) {
    return false;
  }
  if (entry.status !== "ready") return false;
  if (entry.acceptedDerivative && entry.previewDerivative) {
    if (
      entry.previewDerivative.strategy !== entry.fixStrategy ||
      entry.previewDerivative.targetRatio !== entry.fixTargetRatio
    ) {
      return false;
    }
  }
  return true;
}

export function hasSubmittablePinterestCopy(pinterest: CaptionAssistantPinterestDraft): boolean {
  return Boolean(pinterest.title.trim() && pinterest.description.trim());
}

export function hasSubmittablePerPlatformCaptions(
  facebook: CaptionAssistantFacebookDraft,
  instagram: CaptionAssistantInstagramDraft,
  destinations?: SmartUploadDestinations,
): boolean {
  if (destinations && !destinations.facebook && !destinations.instagram) {
    return true;
  }
  const needsFacebook = destinations?.facebook ?? true;
  const needsInstagram = destinations?.instagram ?? true;
  const facebookOk = !needsFacebook || hasSubmittableSharedCaption({ body: facebook.body, cta: facebook.cta, instagramHashtags: [] });
  const instagramOk =
    !needsInstagram ||
    hasSubmittableSharedCaption({
      body: instagram.body,
      cta: instagram.cta,
      instagramHashtags: instagram.instagramHashtags,
    });
  return facebookOk && instagramOk;
}

export function findSubmitValidCaptionPreflightIssue(
  entries: SubmitValidCaptionPreflightEntry[],
): SubmitValidCaptionPreflightIssue | null {
  for (const entry of entries) {
    if (!isSubmitValidCaptionPreflightTarget(entry)) continue;
    const metaOk =
      !metaDestinationsSelected(entry.destinations) ||
      (entry.mode === "per_platform"
        ? hasSubmittablePerPlatformCaptions(
            entry.facebook,
            entry.instagram,
            entry.destinations,
          )
        : hasSubmittableSharedCaption(entry.shared));
    const pinterestOk =
      !entry.destinations.pinterest || hasSubmittablePinterestCopy(entry.pinterest);
    if (!metaOk || !pinterestOk) {
      return { kind: "missing_caption", fileName: entry.fileName };
    }
    if (entry.generatedFrom && entry.stale && !entry.staleAcknowledged) {
      return { kind: "stale_generated", fileName: entry.fileName };
    }
  }
  return null;
}

/** @deprecated Use findSubmitValidCaptionPreflightIssue */
export function findSubmitValidCaptionPreflightFailure(
  entries: SubmitValidCaptionPreflightEntry[],
): string | null {
  const issue = findSubmitValidCaptionPreflightIssue(entries);
  if (!issue) return null;
  return issue.fileName;
}

export function composeFacebookCaptionPreview(draft: CaptionAssistantFacebookDraft): string {
  const parts: string[] = [];
  const body = draft.body.trim();
  const cta = draft.cta.trim();
  if (body) parts.push(body);
  if (cta) parts.push(cta);
  return parts.join("\n\n");
}

export function composeInstagramCaptionPreview(draft: CaptionAssistantInstagramDraft): string {
  const parts: string[] = [];
  const body = draft.body.trim();
  const cta = draft.cta.trim();
  const hashtagLine = formatHashtagsForPreview(draft.instagramHashtags);
  if (body) parts.push(body);
  if (cta) parts.push(cta);
  if (hashtagLine) parts.push(hashtagLine);
  return parts.join("\n\n");
}

export type CaptionFinalizePayload =
  | { mode: "shared"; caption: string; pinterestTitle: string; pinterestDescription: string }
  | {
      mode: "per_platform";
      facebookCaption: string;
      instagramCaption: string;
      pinterestTitle: string;
      pinterestDescription: string;
    };

/** Composed captions for preview and finalize bridge. */
export function buildCaptionFinalizePayload(state: CaptionAssistantState): CaptionFinalizePayload {
  const pinterestTitle = state.pinterest.title.trim();
  const pinterestDescription = state.pinterest.description.trim();
  if (state.mode === "per_platform") {
    return {
      mode: "per_platform",
      facebookCaption: composeFacebookCaptionPreview(state.facebook),
      instagramCaption: composeInstagramCaptionPreview(state.instagram),
      pinterestTitle,
      pinterestDescription,
    };
  }
  return {
    mode: "shared",
    caption: composeSharedCaptionPreview(state.shared),
    pinterestTitle,
    pinterestDescription,
  };
}

/** Composed caption for shared mode preview and finalize. */
export function composeSharedCaptionPreview(draft: CaptionAssistantDraft): string {
  const parts: string[] = [];
  const body = draft.body.trim();
  const cta = draft.cta.trim();
  const hashtagLine = formatHashtagsForPreview(draft.instagramHashtags);

  if (body) parts.push(body);
  if (cta) parts.push(cta);
  if (hashtagLine) parts.push(hashtagLine);

  return parts.join("\n\n");
}

export const CAPTION_ASSISTANT_CONTENT_CATEGORIES = CONTENT_CATEGORIES;
export const CAPTION_ASSISTANT_AUDIENCES = AUDIENCES;
