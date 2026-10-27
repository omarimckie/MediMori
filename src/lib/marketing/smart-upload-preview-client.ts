export type PreviewRegenerationReset = {
  acceptedPreview: null;
  status: "needs_attention";
};

/** Clear acceptance before discarding/replacing a preview blob. */
export function invalidateAcceptedBeforePreviewRegeneration(): PreviewRegenerationReset {
  return {
    acceptedPreview: null,
    status: "needs_attention",
  };
}

export function canStartPreviewGeneration(
  entryId: string,
  previewGeneratingEntryId: string | null,
): boolean {
  if (!previewGeneratingEntryId) return true;
  return previewGeneratingEntryId !== entryId;
}
