import {
  createPrivateMarketingDownloadUrl,
  readLocalPrivateMarketingFile,
} from "./marketing-blob";
import { isFreeResourceContent } from "./content-metadata";
import { fileAssetForContent, privateBlobPathFromAsset } from "./resource-assets";
import type { MarketingStore } from "./store";

export type ResourceDownloadResult =
  | { kind: "not_found" }
  | { kind: "local_file"; buffer: Buffer; mimeType: string; fileName: string }
  | { kind: "redirect"; url: string };

export async function resolveFreeResourceDownload(
  store: MarketingStore,
  contentId: string,
): Promise<ResourceDownloadResult> {
  const content = await store.getContent(contentId);
  if (!content || !isFreeResourceContent(content) || content.status !== "published") {
    return { kind: "not_found" };
  }

  const assets = await store.listAssets();
  const fileAsset = fileAssetForContent(assets, content);
  const pathname = fileAsset ? privateBlobPathFromAsset(fileAsset) : null;
  if (!fileAsset || !pathname) {
    return { kind: "not_found" };
  }

  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "resource_downloaded",
    campaignId: content.campaignId,
    contentId: content.id,
    platform: "website",
    properties: {
      slug: content.metadata.slug ?? null,
      assetId: fileAsset.id,
    },
  });

  const local = await readLocalPrivateMarketingFile(pathname);
  if (local) {
    return {
      kind: "local_file",
      buffer: local,
      mimeType: fileAsset.mimeType ?? "application/octet-stream",
      fileName: fileAsset.name || "download",
    };
  }

  const signedUrl = await createPrivateMarketingDownloadUrl(pathname);
  return { kind: "redirect", url: signedUrl };
}
