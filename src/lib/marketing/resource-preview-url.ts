import { issueSignedToken, presignUrl } from "@vercel/blob";
import {
  hasMarketingBlobToken,
  isMarketingPublicResourcePreviewPathname,
  MARKETING_SIGNED_URL_TTL_MS,
  tryResolveMarketingBlobPathnameFromUrl,
} from "./marketing-blob";
import type { MarketingAsset, MarketingContent } from "./types";
import type { MarketingStore } from "./store";

let signedGetUrlFactoryForTests: ((pathname: string) => Promise<string>) | null = null;

/** Test seam — avoids live @vercel/blob credentials in unit tests. */
export function setResourcePreviewSignedGetUrlFactoryForTests(
  factory: ((pathname: string) => Promise<string>) | null,
): void {
  signedGetUrlFactoryForTests = factory;
}

export function resourcePreviewBlobPathnameFromAsset(asset: MarketingAsset): string | null {
  if (asset.type !== "resource_preview") return null;
  return tryResolveMarketingBlobPathnameFromUrl(asset.url);
}

/**
 * Short-lived signed GET URL for a private-store resource preview (admin review only).
 */
export async function createResourcePreviewSignedGetUrl(pathname: string): Promise<string> {
  if (!isMarketingPublicResourcePreviewPathname(pathname)) {
    throw new Error("Invalid resource preview pathname.");
  }
  if (signedGetUrlFactoryForTests) {
    return signedGetUrlFactoryForTests(pathname);
  }
  if (!hasMarketingBlobToken()) {
    throw new Error("Blob storage is not configured.");
  }
  const validUntil = Date.now() + MARKETING_SIGNED_URL_TTL_MS;
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
  return presignedUrl;
}

export async function resolveFreeResourcePreviewUrlForContent(
  store: MarketingStore,
  content: MarketingContent,
): Promise<string | null> {
  for (const assetId of content.assetIds) {
    const asset = await store.getAsset(assetId);
    if (!asset?.approved || asset.type !== "resource_preview") continue;
    const pathname = resourcePreviewBlobPathnameFromAsset(asset);
    if (!pathname) continue;
    return await createResourcePreviewSignedGetUrl(pathname);
  }
  return null;
}
