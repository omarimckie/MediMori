import { assessCaptionGenerationReadiness } from "./smart-upload-caption-client";

/** Minimal per-file fields needed to stage and generate a caption in one user action. */
export type CaptionGenerationFileSnapshot = {
  uploadIntent: string | null;
  pathname: string | null;
  publicUrl: string | null;
  status: string;
  error: string | null;
  finalizeKey: string;
  fixStrategy: string;
  fixTargetRatio: string;
  /** Meta caption image is ready even when file status is needs_attention (e.g. Pinterest-only fix pending). */
  captionImagePreparationReady: boolean;
  acceptedPreview: {
    uploadIntent: string;
    pathname: string;
    strategy: string;
    targetRatio: string;
  } | null;
  preview: {
    strategy: string;
    targetRatio: string;
  } | null;
};

export type EnsureStagedForCaptionGenerationResult =
  | { ok: true; file: CaptionGenerationFileSnapshot; stagedInThisCall: boolean }
  | { ok: false; message: string };

/**
 * Ensures blob refs exist for caption generation, staging when needed in the same
 * async flow. Uses the returned snapshot from `stageFile` — not React state.
 */
export async function ensureStagedForCaptionGeneration(
  file: CaptionGenerationFileSnapshot,
  stageFile: () => Promise<CaptionGenerationFileSnapshot>,
): Promise<EnsureStagedForCaptionGenerationResult> {
  let working = file;
  let stagedInThisCall = false;

  if (!working.uploadIntent?.trim() || !working.pathname?.trim()) {
    working = await stageFile();
    stagedInThisCall = true;
  }

  if (working.status === "needs_attention" && !working.captionImagePreparationReady) {
    return {
      ok: false,
      message: "Fix image validation issues before generating a caption.",
    };
  }

  const stagedRefsReady =
    Boolean(working.uploadIntent?.trim()) && Boolean(working.pathname?.trim());
  const statusAllowsCaption =
    working.status === "ready" ||
    (working.status === "needs_attention" && working.captionImagePreparationReady);

  if (!statusAllowsCaption || !stagedRefsReady) {
    return {
      ok: false,
      message: working.error?.trim() || "Upload or validation failed.",
    };
  }

  const readiness = assessCaptionGenerationReadiness({
    status: working.captionImagePreparationReady && working.status === "needs_attention"
      ? "ready"
      : working.status,
    uploadIntent: working.uploadIntent,
    pathname: working.pathname,
    acceptedPreview: working.acceptedPreview,
    preview: working.preview,
    fixStrategy: working.fixStrategy,
    fixTargetRatio: working.fixTargetRatio,
  });

  if (!readiness.ready) {
    return { ok: false, message: readiness.reason };
  }

  return { ok: true, file: working, stagedInThisCall };
}
