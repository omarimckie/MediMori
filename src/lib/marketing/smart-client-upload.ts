import { isMarketingPublicResourcePreviewPathname } from "./marketing-blob";
import { MAX_MARKETING_IMAGE_BYTES } from "./file-validation";
import { verifySmartUploadIntentForPathname } from "./smart-upload-intent";

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type SmartUploadClientPayload = {
  uploadIntent: string;
};

export function parseSmartUploadClientPayload(clientPayload: string | null): SmartUploadClientPayload {
  if (!clientPayload?.trim()) {
    throw new Error("Missing upload payload.");
  }
  try {
    const parsed = JSON.parse(clientPayload) as { uploadIntent?: string };
    const uploadIntent = String(parsed.uploadIntent ?? "").trim();
    if (!uploadIntent) {
      throw new Error("Missing upload intent.");
    }
    return { uploadIntent };
  } catch (error) {
    if (error instanceof Error && /Missing|Invalid/.test(error.message)) {
      throw error;
    }
    throw new Error("Invalid upload payload.");
  }
}

export function smartUploadPutConstraints(pathname: string): {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
} {
  if (!isMarketingPublicResourcePreviewPathname(pathname)) {
    throw new Error("Invalid smart upload pathname.");
  }
  return {
    allowedContentTypes: ALLOWED_CONTENT_TYPES,
    maximumSizeInBytes: MAX_MARKETING_IMAGE_BYTES,
  };
}

export function smartUploadClientUploadTokenConstraints(
  pathname: string,
  clientPayload: string | null,
  adminUsername: string | null,
): {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: false;
} {
  const { uploadIntent } = parseSmartUploadClientPayload(clientPayload);
  verifySmartUploadIntentForPathname(uploadIntent, adminUsername, pathname);
  const constraints = smartUploadPutConstraints(pathname);
  return { ...constraints, addRandomSuffix: false };
}
