import { absoluteUrl } from "@/lib/site";
import { resolvePublishableMarketingAssetUrl } from "./marketing-asset-public-image-url";
import {
  formatAspectRatioLabel,
  resolveCatalogAssetTruthForSync,
} from "./asset-truth";
import {
  CANONICAL_BOOK_COVERS,
  catalogAssetIdForBookCover,
  findCatalogAssetByCanonicalUrl,
  publicFileExistsForUrl,
} from "./canonical-asset-library";
import { catalogBooks } from "./brain";
import {
  committedCharacterVisualAssets,
  committedProductCoverVisualAssets,
  getCharacterVisualAssetCatalog,
  resolvedAssetPathForCatalog,
  visualAssetTags,
} from "./visual-asset-catalog";
import { mergeProtectedTags } from "./visual-intelligence/asset-semantics";
import type { MarketingStore } from "./store";
import type { MarketingAsset, MarketingContent } from "./types";

async function catalogAssetFields(url: string) {
  const truth = await resolveCatalogAssetTruthForSync(url);
  if (!truth) {
    return {
      aspectRatio: null,
      imageWidth: null,
      imageHeight: null,
      mimeType: null,
    };
  }
  return {
    aspectRatio: formatAspectRatioLabel(truth.width, truth.height),
    imageWidth: truth.width,
    imageHeight: truth.height,
    mimeType: truth.mimeType,
  };
}

function assetNeedsPersistedTruth(asset: MarketingAsset): boolean {
  return !(asset.imageWidth && asset.imageHeight);
}

/** Backfill persisted dimensions for catalog rows (probe or committed manifest). */
export async function syncCatalogAssetTruth(store: MarketingStore) {
  const catalog = (await store.listAssets()).filter((asset) => asset.source === "catalog");
  for (const asset of catalog) {
    if (!assetNeedsPersistedTruth(asset)) continue;
    if (!asset.url?.trim()) continue;
    const fields = await catalogAssetFields(asset.url);
    if (!fields.imageWidth || !fields.imageHeight) continue;
    await store.updateAsset(asset.id, {
      imageWidth: fields.imageWidth,
      imageHeight: fields.imageHeight,
      mimeType: fields.mimeType,
      aspectRatio: fields.aspectRatio,
    });
  }
}

async function ensureBookCatalogAssets(store: MarketingStore) {
  const existing = await store.listAssets();

  for (const book of catalogBooks()) {
    if (book.coverImageUrl && !publicFileExistsForUrl(book.coverImageUrl)) {
      continue;
    }
    if (book.coverImageUrl) {
      const coverMeta = CANONICAL_BOOK_COVERS.find((row) => row.bookId === book.id);
      const stableId = coverMeta ? catalogAssetIdForBookCover(coverMeta.id) : crypto.randomUUID();
      if (!findCatalogAssetByCanonicalUrl(existing, book.coverImageUrl)) {
        const image = await catalogAssetFields(book.coverImageUrl);
        await store.createAsset({
          id: stableId,
          name: `${book.title} cover`,
          type: "cover",
          source: "catalog",
          bookId: book.id,
          characterId: book.characterId,
          campaignId: null,
          approved: true,
          usageRestrictions: "Approved storefront cover. Do not alter medical meaning.",
          aspectRatio: image.aspectRatio,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
          mimeType: image.mimeType,
          tags: mergeProtectedTags(["cover", book.id], book.coverImageUrl),
          url: book.coverImageUrl,
          altText: `${book.title} cover`,
          isDemo: false,
        });
      }
    }
    for (const [index, url] of book.insideImageUrls.entries()) {
      if (!publicFileExistsForUrl(url)) continue;
      if (findCatalogAssetByCanonicalUrl(existing, url)) continue;
      const image = await catalogAssetFields(url);
      await store.createAsset({
        id: crypto.randomUUID(),
        name: `${book.title} interior ${index + 1}`,
        type: "interior",
        source: "catalog",
        bookId: book.id,
        characterId: book.characterId,
        campaignId: null,
        approved: true,
        usageRestrictions: "Approved interior preview from the storefront.",
        aspectRatio: image.aspectRatio,
        imageWidth: image.imageWidth,
        imageHeight: image.imageHeight,
        mimeType: image.mimeType,
        tags: mergeProtectedTags(["interior", book.id], url),
        url,
        altText: `${book.title} interior preview ${index + 1}`,
        isDemo: false,
      });
    }
  }
}

async function ensureProductCoverCatalogAssets(store: MarketingStore) {
  const existing = await store.listAssets();
  for (const entry of committedProductCoverVisualAssets()) {
    const url = resolvedAssetPathForCatalog(entry);
    if (!publicFileExistsForUrl(url)) continue;
    if (findCatalogAssetByCanonicalUrl(existing, url)) continue;
    const image = await catalogAssetFields(url);
    await store.createAsset({
      id: entry.catalogRowId,
      name: entry.displayName,
      type: "cover",
      source: "catalog",
      bookId: entry.associatedBookId,
      characterId: entry.characterId,
      campaignId: null,
      approved: true,
      usageRestrictions: "Approved catalog book cover.",
      aspectRatio: image.aspectRatio,
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
      mimeType: image.mimeType,
      tags: mergeProtectedTags(visualAssetTags(entry), url),
      url,
      altText: entry.displayName,
      isDemo: false,
    });
  }
}

async function ensureCharacterVisualCatalogAssets(store: MarketingStore) {
  const existing = await store.listAssets();
  for (const entry of committedCharacterVisualAssets()) {
    const url = resolvedAssetPathForCatalog(entry);
    if (!publicFileExistsForUrl(url)) continue;
    if (findCatalogAssetByCanonicalUrl(existing, url)) continue;
    const image = await catalogAssetFields(url);
    if (!image.imageWidth || !image.imageHeight) continue;
    await store.createAsset({
      id: entry.catalogRowId,
      name: entry.displayName,
      type: "character",
      source: "catalog",
      bookId: entry.associatedBookId,
      characterId: entry.characterId,
      campaignId: null,
      approved: true,
      usageRestrictions:
        "Approved protected character artwork. Never regenerate, redraw, or alter canonical source files.",
      aspectRatio: image.aspectRatio,
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
      mimeType: image.mimeType,
      tags: mergeProtectedTags(visualAssetTags(entry), url),
      url,
      altText: entry.displayName,
      isDemo: false,
    });
  }
}

export async function ensureCatalogAssets(store: MarketingStore) {
  await ensureBookCatalogAssets(store);
  await ensureProductCoverCatalogAssets(store);
  await ensureCharacterVisualCatalogAssets(store);
  await syncCatalogAssetTruth(store);
  return store.listAssets();
}

/** Total defined vs on-disk character visual assets. */
export function canonicalCharacterLibraryStatus() {
  const defined = getCharacterVisualAssetCatalog().length;
  const committed = committedCharacterVisualAssets().length;
  return {
    defined,
    committed,
    missing: defined - committed,
  };
}

export function toAbsoluteAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return absoluteUrl(url);
}

/** First approved attached asset URL, made absolute. Does not generate images. */
export async function resolveContentImageUrl(
  store: MarketingStore,
  content: MarketingContent,
): Promise<string | null> {
  for (const assetId of content.assetIds) {
    const asset = await store.getAsset(assetId);
    if (!asset?.approved || !asset.url?.trim()) continue;
    return resolvePublishableMarketingAssetUrl(asset, content.status);
  }
  return null;
}
