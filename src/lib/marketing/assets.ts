import { absoluteUrl } from "@/lib/site";
import { catalogBooks, catalogCharacters } from "./brain";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

export async function ensureCatalogAssets(store: MarketingStore) {
  const existing = await store.listAssets();
  if (existing.some((asset) => asset.source === "catalog")) return existing;

  const created = [];
  for (const book of catalogBooks()) {
    if (book.coverImageUrl) {
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
          aspectRatio: "1:1",
          tags: ["cover", book.id],
          url: book.coverImageUrl,
          altText: `${book.title} cover`,
          isDemo: false,
        }),
      );
    }
    for (const [index, url] of book.insideImageUrls.entries()) {
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
          aspectRatio: "4:5",
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
        aspectRatio: "4:5",
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
