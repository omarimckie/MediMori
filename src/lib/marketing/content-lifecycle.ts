import { MANUAL_UPLOAD_SOURCE } from "./content-metadata";
import {
  isPermanentDeleteConfirmed,
  PERMANENT_DELETE_CONFIRMATION,
} from "./content-week-queue";
import {
  deleteMarketingBlob,
  tryResolveMarketingBlobPathnameFromUrl,
} from "./marketing-blob";
import { privateBlobPathFromAsset } from "./resource-assets";
import type { MarketingStore } from "./store";
import type {
  MarketingApproval,
  MarketingAsset,
  MarketingContent,
  MarketingPublication,
} from "./types";

export { PERMANENT_DELETE_CONFIRMATION };

const BLOCKING_CONTENT_STATUSES = new Set<MarketingContent["status"]>([
  "published",
  "scheduled",
]);

const BLOCKING_PUBLICATION_STATUSES = new Set<MarketingPublication["status"]>([
  "published",
  "scheduled",
  "processing",
  "queued",
]);

export function latestRejectionFeedback(approvals: MarketingApproval[]): string | null {
  const rejects = approvals
    .filter((row) => row.action === "reject")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = rejects[0];
  return latest?.feedback?.trim() || null;
}

export async function listPublicationsForContent(
  store: MarketingStore,
  contentId: string,
): Promise<MarketingPublication[]> {
  const all = await store.listPublications();
  return all.filter((row) => row.contentId === contentId);
}

export function assertContentSafeToPermanentlyDelete(
  content: MarketingContent,
  publications: MarketingPublication[],
): void {
  if (content.status !== "rejected") {
    throw new Error("Only rejected content can be permanently deleted.");
  }
  if (BLOCKING_CONTENT_STATUSES.has(content.status)) {
    throw new Error("Published or scheduled content cannot be permanently deleted.");
  }
  for (const publication of publications) {
    if (BLOCKING_PUBLICATION_STATUSES.has(publication.status)) {
      throw new Error(
        `Cannot delete content while a publication is ${publication.status}. Remove or complete the publication lifecycle first.`,
      );
    }
  }
}

export async function countContentReferencingAsset(
  store: MarketingStore,
  assetId: string,
  excludingContentId?: string,
): Promise<number> {
  const all = await store.listContent();
  return all.filter(
    (item) =>
      item.id !== excludingContentId && item.assetIds.includes(assetId),
  ).length;
}

async function deleteManualUploadAssetBlob(asset: MarketingAsset): Promise<void> {
  if (asset.type === "resource_file") {
    const pathname = privateBlobPathFromAsset(asset);
    if (pathname) await deleteMarketingBlob(pathname);
    return;
  }
  const pathname = tryResolveMarketingBlobPathnameFromUrl(asset.url);
  if (pathname) await deleteMarketingBlob(pathname);
}

export async function restoreRejectedContent(
  store: MarketingStore,
  contentId: string,
  actor: string | null,
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  if (content.status !== "rejected") {
    throw new Error("Only rejected content can be restored.");
  }
  const updated = await store.updateContent(contentId, { status: "needs_review" });
  if (!updated) throw new Error("Content not found.");
  await store.addApproval({
    id: crypto.randomUUID(),
    contentId,
    action: "restore",
    actor,
    feedback: "Restored to approval queue.",
    previousBody: content.body,
    newBody: content.body,
    preferenceSignals: [],
  });
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_restored",
    campaignId: content.campaignId,
    contentId,
    platform: content.platform,
    properties: {},
  });
  return updated;
}

export async function permanentlyDeleteRejectedContent(
  store: MarketingStore,
  contentId: string,
  input: { confirmPermanentDelete: unknown; actor: string | null },
) {
  if (!isPermanentDeleteConfirmed(input.confirmPermanentDelete)) {
    throw new Error("Permanent deletion requires explicit confirmation.");
  }

  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  const publications = await listPublicationsForContent(store, contentId);
  assertContentSafeToPermanentlyDelete(content, publications);

  const assetIds = [...content.assetIds];
  const deleted = await store.deleteContent(contentId);
  if (!deleted) throw new Error("Content not found.");

  const cleanedAssets: string[] = [];
  for (const assetId of assetIds) {
    const asset = await store.getAsset(assetId);
    if (!asset || asset.source !== MANUAL_UPLOAD_SOURCE) continue;
    const refs = await countContentReferencingAsset(store, assetId);
    if (refs > 0) continue;
    await deleteManualUploadAssetBlob(asset);
    await store.deleteAsset(assetId);
    cleanedAssets.push(assetId);
  }

  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_permanently_deleted",
    campaignId: content.campaignId,
    contentId,
    platform: content.platform,
    properties: { cleanedAssetIds: cleanedAssets },
  });

  return { deleted: true, contentId, cleanedAssetIds: cleanedAssets };
}
