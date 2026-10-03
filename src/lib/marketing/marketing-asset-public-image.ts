import {
  isMarketingPublicResourcePreviewPathname,
  readMarketingBlobBuffer,
  tryResolveMarketingBlobPathnameFromUrl,
} from "./marketing-blob";
import type { MarketingStore } from "./store";
import type { ContentStatus, MarketingAsset } from "./types";

/** Conservative cache for proxy images (asset bytes may be replaced under same id). */
export const MARKETING_ASSET_PUBLIC_IMAGE_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600";

/** Content statuses that allow anonymous proxy + canonical Meta image URL. */
export const PUBLIC_MARKETING_ASSET_CONTENT_STATUSES: readonly ContentStatus[] = [
  "approved",
  "scheduled",
  "published",
  "failed",
];

const PUBLIC_MARKETING_ASSET_CONTENT_STATUS_SET = new Set<ContentStatus>(
  PUBLIC_MARKETING_ASSET_CONTENT_STATUSES,
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isContentStatusEligibleForPublicMarketingAssetProxy(
  status: ContentStatus,
): boolean {
  return PUBLIC_MARKETING_ASSET_CONTENT_STATUS_SET.has(status);
}

export function parseMarketingAssetPublicImageId(assetId: string): string | null {
  const trimmed = assetId.trim();
  if (!UUID_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function marketingPublicImagePathnameFromAsset(asset: MarketingAsset): string | null {
  const pathname = tryResolveMarketingBlobPathnameFromUrl(asset.url);
  if (!pathname || !isMarketingPublicResourcePreviewPathname(pathname)) return null;
  if (pathname.includes("..")) return null;
  return pathname;
}

export function isImageMarketingAssetMime(mimeType: string | null | undefined): boolean {
  const mime = mimeType?.trim().toLowerCase() ?? "";
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

/** Blob-backed marketing/public image row (not yet considering content status). */
export function isBlobBackedMarketingPublicImageAsset(asset: MarketingAsset): boolean {
  if (!asset.approved) return false;
  if (!isImageMarketingAssetMime(asset.mimeType)) return false;
  return marketingPublicImagePathnameFromAsset(asset) !== null;
}

export async function isMarketingAssetReferencedByEligibleContent(
  store: MarketingStore,
  assetId: string,
): Promise<boolean> {
  const contents = await store.listContent();
  return contents.some(
    (row) =>
      row.assetIds.includes(assetId) &&
      isContentStatusEligibleForPublicMarketingAssetProxy(row.status),
  );
}

export async function isMarketingAssetPublicImageEligible(
  store: MarketingStore,
  asset: MarketingAsset,
): Promise<boolean> {
  if (!isBlobBackedMarketingPublicImageAsset(asset)) return false;
  return await isMarketingAssetReferencedByEligibleContent(store, asset.id);
}

export type MarketingAssetPublicImageResult =
  | { kind: "not_found" }
  | { kind: "image"; buffer: Buffer; mimeType: string }
  | { kind: "headers_only"; mimeType: string };

let bufferReaderForTests: ((pathname: string) => Promise<Buffer>) | null = null;
let bufferReadCountForTests = 0;

export function setMarketingAssetPublicImageBufferReaderForTests(
  reader: ((pathname: string) => Promise<Buffer>) | null,
): void {
  bufferReaderForTests = reader;
  bufferReadCountForTests = 0;
}

export function getMarketingAssetPublicImageBufferReadCountForTests(): number {
  return bufferReadCountForTests;
}

async function readBlobBuffer(pathname: string): Promise<Buffer> {
  bufferReadCountForTests += 1;
  if (bufferReaderForTests) {
    return bufferReaderForTests(pathname);
  }
  return readMarketingBlobBuffer(pathname, "public");
}

export async function resolveMarketingAssetPublicImage(
  store: MarketingStore,
  assetId: string,
  options: { includeBody: boolean },
): Promise<MarketingAssetPublicImageResult> {
  const parsedId = parseMarketingAssetPublicImageId(assetId);
  if (!parsedId) return { kind: "not_found" };

  const asset = await store.getAsset(parsedId);
  if (!asset) return { kind: "not_found" };
  if (!(await isMarketingAssetPublicImageEligible(store, asset))) {
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

export function marketingAssetPublicImageResponse(
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
    "Cache-Control": MARKETING_ASSET_PUBLIC_IMAGE_CACHE_CONTROL,
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
