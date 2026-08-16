import { issueSignedToken, presignUrl } from "@vercel/blob";

/** Short-lived private GET for one reader page image. */
export const READER_PAGE_SIGNED_URL_TTL_MS = 5 * 60 * 1000;

export async function createPrivateReaderPageUrl(
  pathname: string,
): Promise<{ url: string; expiresAt: number }> {
  const validUntil = Date.now() + READER_PAGE_SIGNED_URL_TTL_MS;
  const signedToken = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return { url: presignedUrl, expiresAt: validUntil };
}
