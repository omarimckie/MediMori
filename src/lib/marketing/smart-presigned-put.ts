import { issueSignedToken, parseStoreIdFromDelegationToken, presignUrl } from "@vercel/blob";
import { hasMarketingBlobToken } from "./marketing-blob";
import { smartUploadPutConstraints } from "./smart-client-upload";
import { verifySmartUploadIntentForPathname } from "./smart-upload-intent";

export const SMART_UPLOAD_PUT_PRESIGN_TTL_MS = 15 * 60 * 1000;

export function parseSmartUploadUrlBody(record: Record<string, unknown>): {
  uploadIntent: string;
  pathname: string;
} {
  const uploadIntent = String(record.uploadIntent ?? "").trim();
  const pathname = String(record.pathname ?? "").trim();
  if (!uploadIntent) throw new Error("uploadIntent is required.");
  if (!pathname) throw new Error("pathname is required.");
  return { uploadIntent, pathname };
}

export function assertSmartUploadUrlAuthorized(
  uploadIntent: string,
  pathname: string,
  actorUsername: string | null,
): void {
  verifySmartUploadIntentForPathname(uploadIntent, actorUsername, pathname);
  smartUploadPutConstraints(pathname);
}

export function publicMarketingBlobUrlFromDelegation(pathname: string, delegationToken: string): string {
  const storeId = parseStoreIdFromDelegationToken(delegationToken);
  return `https://${storeId}.public.blob.vercel-storage.com/${pathname}`;
}

export async function createSmartUploadPutPresignedUrl(input: {
  pathname: string;
}): Promise<{
  presignedUrl: string;
  pathname: string;
  validUntil: number;
  publicUrl: string;
}> {
  if (!hasMarketingBlobToken()) {
    throw new Error("Blob storage is not configured.");
  }
  const constraints = smartUploadPutConstraints(input.pathname);
  const validUntil = Date.now() + SMART_UPLOAD_PUT_PRESIGN_TTL_MS;
  const signedToken = await issueSignedToken({
    pathname: input.pathname,
    operations: ["put"],
    validUntil,
    allowedContentTypes: constraints.allowedContentTypes,
    maximumSizeInBytes: constraints.maximumSizeInBytes,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "put",
    pathname: input.pathname,
    validUntil,
    access: "public",
    allowedContentTypes: constraints.allowedContentTypes,
    maximumSizeInBytes: constraints.maximumSizeInBytes,
    addRandomSuffix: false,
  });
  return {
    presignedUrl,
    pathname: input.pathname,
    validUntil,
    publicUrl: publicMarketingBlobUrlFromDelegation(input.pathname, signedToken.delegationToken),
  };
}
