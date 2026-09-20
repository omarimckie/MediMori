import { absoluteUrl } from "@/lib/site";
import {
  formatAspectRatioLabel,
  resolveCatalogAssetTruthForSync,
} from "./asset-truth";
import { catalogBooks, catalogCharacters } from "./brain";
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

export async function ensureCatalogAssets(store: MarketingStore) {
  const existing = await store.listAssets();
  if (existing.some((asset) => asset.source === "catalog")) {
    await syncCatalogAssetTruth(store);
    return store.listAssets();
  }

  const created = [];
  for (const book of catalogBooks()) {
    if (book.coverImageUrl) {
      const image = await catalogAssetFields(book.coverImageUrl);
      created.push(
        await store.createAsset({
          id: crypto.randomUUID(),
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
          tags: ["cover", book.id],
          url: book.coverImageUrl,
          altText: `${book.title} cover`,
          isDemo: false,
        }),
      );
    }
    for (const [index, url] of book.insideImageUrls.entries()) {
      const image = await catalogAssetFields(url);
      created.push(
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
          tags: ["interior", book.id],
          url,
          altText: `${book.title} interior preview ${index + 1}`,
          isDemo: false,
        }),
      );
    }
  }

  for (const character of catalogCharacters()) {
    if (!character.imageSrc) continue;
    const image = await catalogAssetFields(character.imageSrc);
    created.push(
      await store.createAsset({
        id: crypto.randomUUID(),
        name: `${character.name} character art`,
        type: "character",
        source: "catalog",
        bookId: character.id === "amara" ? "book-one" : character.id === "aj" ? "book-three" : null,
        characterId: character.id,
        campaignId: null,
        approved: true,
        usageRestrictions: "Approved character artwork. Keep personality descriptions catalog-accurate.",
        aspectRatio: image.aspectRatio,
        imageWidth: image.imageWidth,
        imageHeight: image.imageHeight,
        mimeType: image.mimeType,
        tags: ["character", character.id],
        url: character.imageSrc,
        altText: character.name,
        isDemo: false,
      }),
    );
  }

  return store.listAssets();
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
    return toAbsoluteAssetUrl(asset.url.trim());
  }
  return null;
}
