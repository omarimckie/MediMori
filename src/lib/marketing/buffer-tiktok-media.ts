import { isPublicHttpsImageUrl, publicImageUrlError } from "./meta";
import type { MarketingAsset, MarketingContent, ContentFormat } from "./types";

export const TIKTOK_UNSUPPORTED_FORMATS = new Set<ContentFormat>(["carousel", "story"]);

export type TikTokMediaKind = "image" | "video";

export function tiktokMediaKindForFormat(format: ContentFormat): TikTokMediaKind | null {
  if (TIKTOK_UNSUPPORTED_FORMATS.has(format)) return null;
  if (format === "reel_script") return "video";
  if (format === "post") return "image";
  return null;
}

export function tiktokUnsupportedFormatMessage(format: ContentFormat): string {
  return `TikTok does not support the "${format}" format in MediMori v1. Use post (image) or reel script (video). Multi-image carousels are not verified for Buffer TikTok.`;
}

function isVideoMime(mimeType: string | null | undefined): boolean {
  const mime = mimeType?.trim().toLowerCase() ?? "";
  return mime.startsWith("video/") && mime !== "video/x-msvideo";
}

function isImageMime(mimeType: string | null | undefined): boolean {
  const mime = mimeType?.trim().toLowerCase() ?? "";
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

export function classifyTikTokAsset(asset: MarketingAsset): TikTokMediaKind | null {
  if (isVideoMime(asset.mimeType)) return "video";
  if (isImageMime(asset.mimeType)) return "image";
  return null;
}

export type TikTokPublishMedia =
  | { kind: "image"; publicUrl: string }
  | { kind: "video"; publicUrl: string };

export function validatePublicHttpsMediaUrl(
  url: string,
  kind: TikTokMediaKind,
): string | null {
  const urlShapeError = publicImageUrlError(url);
  if (urlShapeError) return urlShapeError;
  if (kind === "image" && !isPublicHttpsImageUrl(url)) {
    return "Image URL must be publicly reachable over HTTPS.";
  }
  if (kind === "video" && !/^https:\/\//i.test(url.trim())) {
    return "Video URL must use HTTPS.";
  }
  return null;
}

export function resolveTikTokPublishMedia(
  content: MarketingContent,
  assets: MarketingAsset[],
): { ok: true; media: TikTokPublishMedia } | { ok: false; message: string } {
  const required = tiktokMediaKindForFormat(content.format);
  if (!required) {
    return { ok: false, message: tiktokUnsupportedFormatMessage(content.format) };
  }

  for (const assetId of content.assetIds) {
    const asset = assets.find((row) => row.id === assetId);
    if (!asset?.approved || !asset.url?.trim()) continue;
    const kind = classifyTikTokAsset(asset);
    if (kind !== required) continue;
    const publicUrl = asset.url.trim();
    const urlError = validatePublicHttpsMediaUrl(publicUrl, required);
    if (urlError) {
      return { ok: false, message: urlError };
    }
    return { ok: true, media: { kind: required, publicUrl } };
  }

  if (required === "video") {
    return {
      ok: false,
      message: "TikTok video posts require an approved video asset attached to this content.",
    };
  }
  return {
    ok: false,
    message: "TikTok image posts require an approved image asset attached to this content.",
  };
}