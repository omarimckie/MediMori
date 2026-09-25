import { formatAspectRatioLabel } from "./asset-truth";
import { MANUAL_UPLOAD_SOURCE, PRIVATE_BLOB_PATH_TAG } from "./content-metadata";
import {
  assertImageUpload,
  assertResourceFileUpload,
  extensionForKind,
  probeImageDimensions,
  sanitizeUploadFilename,
} from "./file-validation";
import {
  deleteMarketingBlob,
  tryResolveMarketingBlobPathnameFromUrl,
  uploadPrivateMarketingFile,
  uploadPublicMarketingFile,
} from "./marketing-blob";
import { privateBlobPathFromAsset } from "./resource-assets";
import type { MarketingStore } from "./store";
import type { MarketingAsset } from "./types";

export class MarketingAssetUpdateError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MarketingAssetUpdateError";
    this.status = status;
  }
}

export type MarketingAssetMetadataPatch = {
  name?: string;
  altText?: string | null;
  tags?: string[];
  usageRestrictions?: string | null;
  approved?: boolean;
};

function assertEditableManualUploadAsset(asset: MarketingAsset): void {
  if (asset.source === "catalog") {
    throw new MarketingAssetUpdateError(
      "Catalog assets are tied to storefront files and cannot be edited here.",
      403,
    );
  }
  if (asset.isDemo) {
    throw new MarketingAssetUpdateError("Demo assets cannot be edited.", 403);
  }
  if (asset.source !== MANUAL_UPLOAD_SOURCE) {
    throw new MarketingAssetUpdateError(
      "Only owner-uploaded manual assets can be edited or replaced.",
      403,
    );
  }
  if (
    asset.type !== "upload" &&
    asset.type !== "resource_preview" &&
    asset.type !== "resource_file"
  ) {
    throw new MarketingAssetUpdateError("This asset type cannot be edited.", 403);
  }
}

function tagsWithPrivateBlobPath(tags: string[], pathname: string): string[] {
  const kept = tags.filter((tag) => !tag.startsWith(PRIVATE_BLOB_PATH_TAG));
  return [...kept, `${PRIVATE_BLOB_PATH_TAG}${pathname}`];
}

async function rollbackUploaded(pathnames: string[]) {
  for (const pathname of pathnames) {
    await deleteMarketingBlob(pathname);
  }
}

async function cleanupReplacedBlob(asset: MarketingAsset): Promise<void> {
  if (process.env.MARKETING_ASSET_UPDATE_TEST_SIMULATE_OLD_BLOB_CLEANUP_THROW === "1") {
    throw new Error("simulated old blob cleanup failure");
  }
  if (asset.type === "resource_file") {
    const oldPath = privateBlobPathFromAsset(asset);
    if (oldPath) await deleteMarketingBlob(oldPath);
    return;
  }
  const derived = tryResolveMarketingBlobPathnameFromUrl(asset.url);
  if (derived) await deleteMarketingBlob(derived);
  // When pathname cannot be derived safely from a public URL, the old blob is left in place.
}

async function bestEffortCleanupReplacedBlob(asset: MarketingAsset): Promise<void> {
  try {
    await cleanupReplacedBlob(asset);
  } catch {
    // DB already references the new blob; old blob deletion is best-effort only.
  }
}

export async function updateMarketingAssetMetadata(
  store: MarketingStore,
  assetId: string,
  patch: MarketingAssetMetadataPatch,
): Promise<MarketingAsset> {
  const asset = await store.getAsset(assetId);
  if (!asset) throw new MarketingAssetUpdateError("Asset not found.", 404);
  assertEditableManualUploadAsset(asset);

  const next: Partial<MarketingAsset> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new MarketingAssetUpdateError("Name cannot be empty.", 400);
    next.name = name;
  }
  if (patch.altText !== undefined) next.altText = patch.altText?.trim() || null;
  if (patch.usageRestrictions !== undefined) {
    next.usageRestrictions = patch.usageRestrictions?.trim() || null;
  }
  if (patch.tags !== undefined) {
    if (!Array.isArray(patch.tags) || patch.tags.some((tag) => typeof tag !== "string")) {
      throw new MarketingAssetUpdateError("Tags must be an array of strings.", 400);
    }
    next.tags = patch.tags.map((tag) => tag.trim()).filter(Boolean);
  }
  if (patch.approved !== undefined) next.approved = patch.approved;

  const updated = await store.updateAsset(assetId, next);
  if (!updated) throw new MarketingAssetUpdateError("Asset not found.", 404);
  return updated;
}

export async function replaceMarketingAssetFile(
  store: MarketingStore,
  assetId: string,
  fileBuffer: Buffer,
  filename: string,
  options?: { name?: string; altText?: string },
): Promise<MarketingAsset> {
  const asset = await store.getAsset(assetId);
  if (!asset) throw new MarketingAssetUpdateError("Asset not found.", 404);
  assertEditableManualUploadAsset(asset);

  const uploadedPathnames: string[] = [];
  let updated: MarketingAsset;

  try {
    if (asset.type === "resource_file") {
      const { kind, mime } = assertResourceFileUpload(fileBuffer);
      const extension = extensionForKind(kind);
      const uploaded = await uploadPrivateMarketingFile(fileBuffer, mime, extension);
      uploadedPathnames.push(uploaded.pathname);

      const tags = tagsWithPrivateBlobPath(asset.tags, uploaded.pathname);
      const row = await store.updateAsset(assetId, {
        name: options?.name?.trim() || sanitizeUploadFilename(filename),
        altText: options?.altText !== undefined ? options.altText.trim() || null : asset.altText,
        mimeType: mime,
        aspectRatio: null,
        imageWidth: null,
        imageHeight: null,
        url: null,
        tags,
      });
      if (!row) throw new MarketingAssetUpdateError("Asset not found.", 404);
      updated = row;
    } else {
      const { kind, mime } = assertImageUpload(fileBuffer);
      const dimensions = await probeImageDimensions(fileBuffer);
      const extension = extensionForKind(kind);
      const uploaded = await uploadPublicMarketingFile(fileBuffer, mime, extension);
      uploadedPathnames.push(uploaded.pathname);

      const row = await store.updateAsset(assetId, {
        name: options?.name?.trim() || sanitizeUploadFilename(filename),
        altText: options?.altText !== undefined ? options.altText.trim() || null : asset.altText,
        url: uploaded.url,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        mimeType: dimensions.mimeType,
        aspectRatio: formatAspectRatioLabel(dimensions.width, dimensions.height),
      });
      if (!row) throw new MarketingAssetUpdateError("Asset not found.", 404);
      updated = row;
    }
  } catch (error) {
    await rollbackUploaded(uploadedPathnames);
    if (error instanceof MarketingAssetUpdateError) throw error;
    const message = error instanceof Error ? error.message : "Replacement failed.";
    throw new MarketingAssetUpdateError(message, 400);
  }

  await bestEffortCleanupReplacedBlob(asset);
  return updated;
}

export async function readReplacementFileFromForm(
  form: FormData,
): Promise<{ buffer: Buffer; filename: string }> {
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new MarketingAssetUpdateError("Expected exactly one file field named file.", 400);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) {
    throw new MarketingAssetUpdateError("Uploaded file is empty.", 400);
  }
  return { buffer, filename: file.name || "upload" };
}
