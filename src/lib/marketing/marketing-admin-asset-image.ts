import {
  isBlobBackedMarketingPublicImageAsset,
  isImageMarketingAssetMime,
  marketingPublicImagePathnameFromAsset,
  parseMarketingAssetPublicImageId,
  type MarketingAssetPublicImageResult,
} from "./marketing-asset-public-image";
import { readMarketingBlobBuffer } from "./marketing-blob";
import { resolvePublishableMarketingAssetUrl } from "./marketing-asset-public-image-url";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

/** Short private cache for authenticated admin previews (bytes served from app). */
export const MARKETING_ADMIN_ASSET_IMAGE_CACHE_CONTROL = "private, max-age=300";

export function marketingAdminAssetImageApiPath(assetId: string): string {
  return `/api/admin/marketing/assets/${assetId}/image`;
}

let bufferReaderForTests: ((pathname: string) => Promise<Buffer>) | null = null;

export function setMarketingAdminAssetImageBufferReaderForTests(
  reader: ((pathname: string) => Promise<Buffer>) | null,
): void {
  bufferReaderForTests = reader;
}

async function readBlobBuffer(pathname: string): Promise<Buffer> {
  if (bufferReaderForTests) {
    return bufferReaderForTests(pathname);
  }
  return readMarketingBlobBuffer(pathname, "public");
}

/**
 * Admin UI preview URL: same-origin proxy for private blob-backed assets;
 * publish/catalog resolution unchanged for non-blob assets.
 */
export async function resolveAdminContentPreviewImageUrl(
  store: MarketingStore,
  content: MarketingContent,
): Promise<string | null> {
  for (const assetId of content.assetIds) {
    const asset = await store.getAsset(assetId);
    if (!asset?.approved || !asset.url?.trim()) continue;

    if (
      isBlobBackedMarketingPublicImageAsset(asset) &&
      marketingPublicImagePathnameFromAsset(asset)
    ) {
      const parsedId = parseMarketingAssetPublicImageId(asset.id);
      if (parsedId) return marketingAdminAssetImageApiPath(parsedId);
    }

    return resolvePublishableMarketingAssetUrl(asset, content.status);
  }
  return null;
}

export async function resolveMarketingAdminAssetImage(
  store: MarketingStore,
  assetId: string,
  options: { includeBody: boolean },
): Promise<MarketingAssetPublicImageResult> {
  const parsedId = parseMarketingAssetPublicImageId(assetId);
  if (!parsedId) return { kind: "not_found" };

  const asset = await store.getAsset(parsedId);
  if (!asset) return { kind: "not_found" };
  if (!isBlobBackedMarketingPublicImageAsset(asset)) {
    return { kind: "not_found" };
  }

  const pathname = marketingPublicImagePathnameFromAsset(asset);
  if (!pathname) return { kind: "not_found" };

  const mimeType = asset.mimeType?.trim().toLowerCase();
  if (!mimeType || !isImageMarketingAssetMime(mimeType)) {
    return { kind: "not_found" };
  }

  if (!options.includeBody) {
    return { kind: "headers_only", mimeType };
  }

  try {
    const buffer = await readBlobBuffer(pathname);
    return { kind: "image", buffer, mimeType };
  } catch {
    return { kind: "not_found" };
  }
}

export function marketingAdminAssetImageResponse(
  result: MarketingAssetPublicImageResult,
  method: "GET" | "HEAD",
): Response {
  if (result.kind === "not_found") {
    return new Response(method === "GET" ? JSON.stringify({ error: "Not found." }) : null, {
      status: 404,
      headers: method === "GET" ? { "Content-Type": "application/json" } : undefined,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": result.mimeType,
    "Cache-Control": MARKETING_ADMIN_ASSET_IMAGE_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };

  if (result.kind === "image") {
    headers["Content-Length"] = String(result.buffer.length);
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(new Uint8Array(result.buffer), { status: 200, headers });
  }

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: "Not found." }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
