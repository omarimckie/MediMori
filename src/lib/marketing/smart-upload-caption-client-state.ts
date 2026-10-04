import type { AudienceId, ContentCategory } from "./types";
import { AUDIENCES, CONTENT_CATEGORIES } from "./types";

export type CaptionAssistantMode = "shared" | "per_platform";

export type CaptionAssistantDraft = {
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
  fixTargetRatio: "4:5" | "1:1";
  finalizeKey: string;
};

/** Per-file caption assistant state (shared mode UI in Phase 4B; per_platform reserved for 4C). */
export type CaptionAssistantState = {
  mode: CaptionAssistantMode;
  instructions: string;
  advanced: CaptionAssistantAdvanced;
  genStatus: CaptionAssistantGenStatus;
  genError: string | null;
  warnings: string[];
  provenance: CaptionAssistantProvenance | null;
  generatedFrom: CaptionInputFingerprint | null;
  stale: boolean;
  staleAcknowledged: boolean;
  shared: CaptionAssistantDraft;
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
    shared: { body: "", cta: "", instagramHashtags: [] },
  };
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

export function isCaptionDraftStale(
  state: CaptionAssistantState,
  context: CaptionFingerprintContext,
): boolean {
  if (!state.generatedFrom) return false;
  const current = buildCaptionInputFingerprint(context);
  return !captionInputFingerprintsEqual(current, state.generatedFrom);
}

export function acknowledgeStaleCaption(state: CaptionAssistantState): CaptionAssistantState {
  if (!state.stale) return state;
  return { ...state, staleAcknowledged: true };
}

/** Recompute stale flag when generation inputs or image identity change (no fetch). */
export function refreshCaptionAssistantStale(
  state: CaptionAssistantState,
  context: CaptionFingerprintContext,
): CaptionAssistantState {
  if (!state.generatedFrom) {
    return state.stale || state.staleAcknowledged
      ? { ...state, stale: false, staleAcknowledged: false }
      : state;
  }
  const stale = isCaptionDraftStale(state, context);
  if (!stale) {
    return { ...state, stale: false, staleAcknowledged: false };
  }
  if (!state.stale) {
    return { ...state, stale: true, staleAcknowledged: false };
  }
  return { ...state, stale: true };
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
  shared: CaptionAssistantDraft;
};

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

/** First file name failing caption preflight, or null if all targets are complete. */
export function findSubmitValidCaptionPreflightFailure(
  entries: SubmitValidCaptionPreflightEntry[],
): string | null {
  for (const entry of entries) {
    if (!isSubmitValidCaptionPreflightTarget(entry)) continue;
    if (!hasSubmittableSharedCaption(entry.shared)) {
      return entry.fileName;
    }
  }
  return null;
}

/** Composed caption for preview and finalize bridge (single string until Phase 4C). */
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
