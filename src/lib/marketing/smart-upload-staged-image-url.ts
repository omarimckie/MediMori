export const SMART_UPLOAD_STAGED_IMAGE_API_PATH =
  "/api/admin/marketing/smart-upload/staged-image";

export function smartUploadStagedImageUrl(input: {
  pathname: string;
  uploadIntent: string;
}): string {
  const pathname = input.pathname.trim();
  const uploadIntent = input.uploadIntent.trim();
  const params = new URLSearchParams({
    pathname,
    uploadIntent,
  });
  return `${SMART_UPLOAD_STAGED_IMAGE_API_PATH}?${params.toString()}`;
}
