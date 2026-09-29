import { absoluteUrl } from "@/lib/site";
import { isFreeResourceContent } from "./content-metadata";
import {
  isMarketingPublicResourcePreviewPathname,
  readMarketingBlobBuffer,
} from "./marketing-blob";
import { resourcePreviewBlobPathnameFromAsset } from "./resource-preview-url";
import type { MarketingStore } from "./store";
import type { MarketingAsset, MarketingContent } from "./types";

export const FREE_RESOURCE_PREVIEW_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export type ResourcePreviewResult =
  | { kind: "not_found" }
  | { kind: "image"; buffer: Buffer; mimeType: string };

let previewBufferReaderForTests: ((pathname: string) => Promise<Buffer>) | null = null;

/** Test seam — avoids live Blob reads in unit tests. */
export function setPreviewBufferReaderForTests(
  reader: ((pathname: string) => Promise<Buffer>) | null,
): void {
  previewBufferReaderForTests = reader;
}

export function freeResourcePreviewApiPath(contentId: string): string {
  return `/api/resources/free/${contentId}/preview`;
}

export type DeliverableFreeResourcePreview = {
  asset: MarketingAsset;
  pathname: string;
};

export function findDeliverableFreeResourcePreview(
  content: MarketingContent,
  assets: MarketingAsset[],
): DeliverableFreeResourcePreview | null {
  if (!isFreeResourceContent(content) || content.status !== "published") {
    return null;
  }

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const assetId of content.assetIds) {
    const asset = assetById.get(assetId);
    if (!asset?.approved || asset.type !== "resource_preview") continue;
    const pathname = resourcePreviewBlobPathnameFromAsset(asset);
    if (!pathname || !isMarketingPublicResourcePreviewPathname(pathname)) continue;
    return { asset, pathname };
  }

  return null;
}

export function hasDeliverableFreeResourcePreview(
  content: MarketingContent,
  assets: MarketingAsset[],
): boolean {
  return findDeliverableFreeResourcePreview(content, assets) !== null;
}

export function freeResourcePublicPreviewMedia(
  resourceId: string,
  hasDeliverablePreview: boolean,
): { imageSrc: string; openGraphImageUrl: string } | null {
  if (!hasDeliverablePreview) return null;
  const imageSrc = freeResourcePreviewApiPath(resourceId);
  return {
    imageSrc,
    openGraphImageUrl: absoluteUrl(imageSrc),
  };
}

function mimeTypeForPreview(pathname: string, assetMime: string | null | undefined): string {
  const fromAsset = assetMime?.trim();
  if (fromAsset?.startsWith("image/")) return fromAsset;
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

export async function resolveFreeResourcePreview(
  store: MarketingStore,
  contentId: string,
): Promise<ResourcePreviewResult> {
  const content = await store.getContent(contentId);
  if (!content) {
    return { kind: "not_found" };
  }

  const assets = await store.listAssets();
  const deliverable = findDeliverableFreeResourcePreview(content, assets);
  if (!deliverable) {
    return { kind: "not_found" };
  }

  const { asset: previewAsset, pathname } = deliverable;

  try {
    const buffer = previewBufferReaderForTests
      ? await previewBufferReaderForTests(pathname)
      : await readMarketingBlobBuffer(pathname, "public");
    return {
      kind: "image",
      buffer,
      mimeType: mimeTypeForPreview(pathname, previewAsset.mimeType),
    };
  } catch {
    return { kind: "not_found" };
  }
}

export async function handleFreeResourcePreviewRequest(
  store: MarketingStore,
  contentId: string,
): Promise<Response> {
  const result = await resolveFreeResourcePreview(store, contentId);
  if (result.kind === "not_found") {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": FREE_RESOURCE_PREVIEW_CACHE_CONTROL,
    },
  });
}
