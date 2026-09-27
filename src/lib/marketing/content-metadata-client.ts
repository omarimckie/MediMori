import type { MarketingAsset } from "./types";

const MANUAL_UPLOAD_SOURCE = "manual_upload";

export function isEditableManualUploadAsset(asset: MarketingAsset): boolean {
  if (asset.source === "catalog" || asset.isDemo) return false;
  if (asset.source !== MANUAL_UPLOAD_SOURCE) return false;
  return (
    asset.type === "upload" ||
    asset.type === "resource_preview" ||
    asset.type === "resource_file"
  );
}
