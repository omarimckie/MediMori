/**
 * Already-public Vercel Blob objects only.
 * One store label, the public Blob host, and an existing marketing/public image path.
 * Query strings, hashes, ports, credentials, private hosts, and other encodings are rejected.
 */
const PUBLIC_BLOB_HOST = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/;
const PUBLIC_IMAGE_PATH = /^\/marketing\/public\/[a-f0-9]{32}\.(?:jpe?g|png|webp)$/i;

/**
 * Returns the canonical stored public Blob URL, or null when the value is not an
 * explicit public marketing image URL. Does not assemble a URL from a separate host or path.
 */
export function explicitPublicMarketingBlobReviewUrl(
  url: string | null | undefined,
): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port || parsed.search || parsed.hash) return null;
  if (!PUBLIC_BLOB_HOST.test(parsed.hostname)) return null;

  const pathname = parsed.pathname;
  if (!PUBLIC_IMAGE_PATH.test(pathname)) return null;
  if (pathname.split("/").some((segment) => segment === "." || segment === "..")) return null;
  try {
    if (decodeURIComponent(pathname) !== pathname) return null;
  } catch {
    return null;
  }

  const hostStart = "https://".length;
  const hostEnd = trimmed.indexOf("/", hostStart);
  if (hostEnd < 0) return null;
  const suppliedHost = trimmed.slice(hostStart, hostEnd);
  if (suppliedHost.toLowerCase() !== parsed.hostname) return null;
  if (trimmed.slice(hostEnd) !== pathname) return null;

  return `https://${parsed.hostname}${pathname}`;
}

/** Browser-safe Content Queue preview. Raw Blob URLs stay rejected unless Preview mode opts in. */
export function isSafeAdminContentPreviewUrl(
  url: string | null | undefined,
  options?: { allowExplicitPublicBlob?: boolean },
): boolean {
  if (options?.allowExplicitPublicBlob && explicitPublicMarketingBlobReviewUrl(url)) {
    return true;
  }
  if (!url?.trim()) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("/")) return false;
  if (/vercel-storage|blob\.|token=|sig=/i.test(trimmed)) return false;
  return /^\/api\/admin\/marketing\/assets\/[0-9a-f-]+\/image$/i.test(trimmed);
}

export function resolveReviewCardImageSrc(
  url: string | null | undefined,
  allowExplicitPublicBlob = false,
): { kind: "proxy" | "public-blob"; src: string } | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("/") && isSafeAdminContentPreviewUrl(trimmed)) {
    return { kind: "proxy", src: trimmed };
  }
  if (!allowExplicitPublicBlob) return null;
  const publicSrc = explicitPublicMarketingBlobReviewUrl(trimmed);
  if (!publicSrc) return null;
  return { kind: "public-blob", src: publicSrc };
}

export function contentQueueShowsApproveReject(status: string): boolean {
  return status === "needs_review";
}

export function contentQueueRejectConfirmMessage(title: string | null, platform: string): string {
  const label = title?.trim() || "this post";
  return `Reject ${label} (${platform})? It will move to rejected and will not be scheduled or published.`;
}
