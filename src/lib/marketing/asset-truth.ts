import fs from "node:fs/promises";
import path from "node:path";
import { catalogTruthFromManifest } from "./catalog-truth-manifest";
import type { MarketingAsset } from "./types";

export type AssetImageTruth = {
  width: number;
  height: number;
  mimeType: string;
  /** width / height */
  aspectRatio: number;
  aspectRatioLabel: string;
};

const truthCache = new Map<string, AssetImageTruth>();

function publicPathFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;
  const relative = trimmed.replace(/^\//, "");
  return path.join(process.cwd(), "public", relative);
}

function parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(pngSig)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function parseJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width && height) return { width, height };
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

export function widthHeightRatio(width: number, height: number): number {
  if (!height) return 0;
  return width / height;
}

export function formatAspectRatioLabel(width: number, height: number): string {
  return `${width}:${height}`;
}

export function truthFromDimensions(
  width: number,
  height: number,
  mimeType: string,
): AssetImageTruth {
  return {
    width,
    height,
    mimeType,
    aspectRatio: widthHeightRatio(width, height),
    aspectRatioLabel: formatAspectRatioLabel(width, height),
  };
}

async function probeFile(filePath: string, cacheKey: string): Promise<AssetImageTruth | null> {
  const cached = truthCache.get(cacheKey);
  if (cached) return cached;

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return null;
  }

  const mimeType = mimeFromPath(filePath);

  try {
    const sharp = await import("sharp");
    const meta = await sharp.default(buffer).metadata();
    if (meta.width && meta.height) {
      const truth = truthFromDimensions(meta.width, meta.height, meta.format ? `image/${meta.format}` : mimeType);
      truthCache.set(cacheKey, truth);
      return truth;
    }
  } catch {
    // fall through to lightweight parsers
  }

  const png = parsePngDimensions(buffer);
  if (png) {
    const truth = truthFromDimensions(png.width, png.height, "image/png");
    truthCache.set(cacheKey, truth);
    return truth;
  }
  const jpeg = parseJpegDimensions(buffer);
  if (jpeg) {
    const truth = truthFromDimensions(jpeg.width, jpeg.height, "image/jpeg");
    truthCache.set(cacheKey, truth);
    return truth;
  }

  return null;
}

/** Probe a site-relative public URL (e.g. /covers/foo.png). */
export async function probePublicAssetUrl(url: string): Promise<AssetImageTruth | null> {
  const filePath = publicPathFromUrl(url);
  if (!filePath) return null;
  return probeFile(filePath, filePath);
}

export function assetTruthFromAssetFields(asset: MarketingAsset): AssetImageTruth | null {
  if (asset.imageWidth && asset.imageHeight) {
    return truthFromDimensions(
      asset.imageWidth,
      asset.imageHeight,
      asset.mimeType ?? "application/octet-stream",
    );
  }
  return null;
}

/**
 * Resolve image truth: persisted DB fields (authoritative) → catalog manifest → local public file probe.
 */
export async function getAssetImageTruth(asset: MarketingAsset): Promise<AssetImageTruth | null> {
  const fromFields = assetTruthFromAssetFields(asset);
  if (fromFields) return fromFields;

  const fromManifest = catalogTruthFromManifest(asset.url);
  if (fromManifest) return fromManifest;

  if (!asset.url?.trim()) return null;
  const filePath = publicPathFromUrl(asset.url);
  if (!filePath) return null;
  return probeFile(filePath, filePath);
}

/** Resolve truth for catalog sync (probe first, then manifest). Does not read persisted fields. */
export async function resolveCatalogAssetTruthForSync(
  url: string,
): Promise<AssetImageTruth | null> {
  const probed = await probePublicAssetUrl(url);
  if (probed) return probed;
  return catalogTruthFromManifest(url);
}

export function clearAssetTruthCacheForTests() {
  truthCache.clear();
}
