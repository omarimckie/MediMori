import { smartUploadStagedImageUrl } from "./smart-upload-staged-image-url";

/** True when the upload must use a browser object URL (queued file or multipart-without-blob). */
export function shouldUseSmartUploadLocalFilePreview(input: {
  uploadIntent: string | null;
  pathname: string | null;
}): boolean {
  if (!input.uploadIntent?.trim() || !input.pathname?.trim()) return true;
  return input.uploadIntent.trim() === "local-multipart";
}

/** Admin-authenticated staged-image route for blob-backed smart uploads. */
export function resolveSmartUploadStagedListPreviewSrc(input: {
  pathname: string | null;
  uploadIntent: string | null;
}): string | null {
  if (shouldUseSmartUploadLocalFilePreview(input)) return null;
  const pathname = input.pathname?.trim();
  const uploadIntent = input.uploadIntent?.trim();
  if (!pathname || !uploadIntent) return null;
  return smartUploadStagedImageUrl({ pathname, uploadIntent });
}
