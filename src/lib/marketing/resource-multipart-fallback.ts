type EnvLike = Record<string, string | undefined>;

/** Same limit as Vercel serverless request body for route handlers. */
export const RESOURCE_MULTIPART_FALLBACK_MAX_BYTES = 4.5 * 1024 * 1024;

/**
 * True on any Vercel deployment (preview or production). Local `next dev` / self-hosted builds omit VERCEL.
 */
export function isVercelDeployedRuntime(env: EnvLike = process.env): boolean {
  return env.VERCEL === "1";
}

/**
 * Multipart fallback to /api/admin/marketing/manual/resource is only safe off Vercel
 * (local disk). On Vercel, missing Blob must surface an error instead.
 */
export function shouldUseResourceMultipartFallbackWhenBlobUnavailable(
  combinedFileBytes: number,
  options: { blobIntentStatus503: boolean; env?: EnvLike },
): boolean {
  const env = options.env ?? process.env;
  if (!options.blobIntentStatus503) return false;
  if (isVercelDeployedRuntime(env)) return false;
  if (combinedFileBytes > RESOURCE_MULTIPART_FALLBACK_MAX_BYTES) return false;
  return true;
}

export function resourceBlobStorageUnavailableMessage(): string {
  return "Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN or configure Vercel Blob with VERCEL_OIDC_TOKEN and BLOB_STORE_ID, then restart the dev server.";
}
