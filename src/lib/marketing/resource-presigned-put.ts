import { issueSignedToken, parseStoreIdFromDelegationToken, presignUrl } from "@vercel/blob";
import { hasMarketingBlobToken } from "./marketing-blob";
import { resourcePutPresignConstraints } from "./resource-client-upload";
import { verifyResourceUploadIntentForBlobToken } from "./resource-upload-intent";

export const RESOURCE_PUT_PRESIGN_TTL_MS = 15 * 60 * 1000;

export type ResourceUploadUrlRole = "preview" | "file";

export function parseResourceUploadUrlBody(record: Record<string, unknown>): {
  uploadIntent: string;
  pathname: string;
  role: ResourceUploadUrlRole;
} {
  const uploadIntent = String(record.uploadIntent ?? "").trim();
  const pathname = String(record.pathname ?? "").trim();
  const role = record.role;
  if (!uploadIntent) throw new Error("uploadIntent is required.");
  if (!pathname) throw new Error("pathname is required.");
  if (role !== "preview" && role !== "file") {
    throw new Error('role must be "preview" or "file".');
  }
  return { uploadIntent, pathname, role };
}

export function assertResourceUploadUrlAuthorized(
  uploadIntent: string,
  pathname: string,
  role: ResourceUploadUrlRole,
  actorUsername: string | null,
): void {
  verifyResourceUploadIntentForBlobToken(uploadIntent, actorUsername, pathname, role);
  resourcePutPresignConstraints(role, pathname);
}

export function publicMarketingBlobUrlFromDelegation(pathname: string, delegationToken: string): string {
  const storeId = parseStoreIdFromDelegationToken(delegationToken);
  return `https://${storeId}.public.blob.vercel-storage.com/${pathname}`;
}

export async function createResourcePutPresignedUrl(input: {
  pathname: string;
  role: ResourceUploadUrlRole;
}): Promise<{
  presignedUrl: string;
  pathname: string;
  validUntil: number;
  publicUrl?: string;
}> {
  if (!hasMarketingBlobToken()) {
    throw new Error("Blob storage is not configured.");
  }
  const access = input.role === "preview" ? "public" : "private";
  const constraints = resourcePutPresignConstraints(input.role, input.pathname);
  const validUntil = Date.now() + RESOURCE_PUT_PRESIGN_TTL_MS;
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
    access,
    allowedContentTypes: constraints.allowedContentTypes,
    maximumSizeInBytes: constraints.maximumSizeInBytes,
    addRandomSuffix: false,
  });
  const result: {
    presignedUrl: string;
    pathname: string;
    validUntil: number;
    publicUrl?: string;
  } = {
    presignedUrl,
    pathname: input.pathname,
    validUntil,
  };
  if (input.role === "preview") {
    result.publicUrl = publicMarketingBlobUrlFromDelegation(input.pathname, signedToken.delegationToken);
  }
  return result;
}
