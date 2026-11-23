import type { SmartUploadDestinations } from "./smart-upload-destinations";
import {
  metaDestinationsSelected,
  tiktokDestinationSelected,
} from "./smart-upload-destinations";

export type SmartUploadTikTokMediaKind = "image" | "video";

export function isMp4VideoBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return buffer.toString("ascii", 4, 8) === "ftyp";
}

export { tiktokDestinationSelected };

export function tiktokVideoOnlyDestinations(destinations: SmartUploadDestinations): boolean {
  return (
    Boolean(destinations.tiktok) &&
    !destinations.facebook &&
    !destinations.instagram &&
    !destinations.pinterest
  );
}

export function assertTikTokVideoCompatibleDestinations(destinations: SmartUploadDestinations): void {
  if (!metaDestinationsSelected(destinations)) return;
  throw new Error(
    "TikTok video uploads cannot be combined with Facebook or Instagram in Smart Upload. Select TikTok only or upload an image.",
  );
}

export function tiktokSmartUploadFormat(
  mediaKind: SmartUploadTikTokMediaKind,
): "post" | "reel_script" {
  return mediaKind === "video" ? "reel_script" : "post";
}