import { catalogBooks } from "./brain";
import {
  RESOURCE_TYPE_LABELS,
  freeResourcePublicPath,
  isFreeResourceContent,
  slugifyResourceTitle,
} from "./content-metadata";
import type { MarketingStore } from "./store";
import type { MarketingAsset, MarketingContent, ResourceType } from "./types";
import { previewAssetForContent } from "./resource-assets";
import { hasDeliverableFreeResourcePreview } from "./resource-preview";

export type PublishedFreeResource = {
  id: string;
  slug: string;
  title: string;
  description: string;
  resourceType: ResourceType;
  resourceTypeLabel: string;
  bookId: string | null;
  bookTitle: string | null;
  relatedCondition: string | null;
  seoTitle: string;
  seoDescription: string;
  previewImageUrl: string | null;
  publicPath: string;
  cta: string | null;
  publishedAt: string | null;
};

export async function ensureUniqueResourceSlug(
  store: MarketingStore,
  title: string,
  excludeContentId?: string,
): Promise<string> {
  const base = slugifyResourceTitle(title);
  const existing = await store.listContent();
  const used = new Set(
    existing
      .filter((item) => item.id !== excludeContentId)
      .map((item) => item.metadata?.slug)
      .filter((slug): slug is string => Boolean(slug)),
  );
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function mapPublishedFreeResource(
  content: MarketingContent,
  assets: MarketingAsset[],
): PublishedFreeResource | null {
  if (!isFreeResourceContent(content) || content.status !== "published") return null;
  const slug = content.metadata.slug;
  if (!slug) return null;
  const preview = previewAssetForContent(assets, content);
  const book = content.bookId ? catalogBooks().find((row) => row.id === content.bookId) : null;
  const resourceType = content.metadata.resourceType ?? "other";
  return {
    id: content.id,
    slug,
    title: content.title ?? "Free resource",
    description: content.body,
    resourceType,
    resourceTypeLabel: RESOURCE_TYPE_LABELS[resourceType],
    bookId: content.bookId,
    bookTitle: book?.title ?? null,
    relatedCondition: content.metadata.relatedCondition ?? null,
    seoTitle: content.seoTitle ?? content.title ?? "Free resource",
    seoDescription: content.seoDescription ?? content.body.slice(0, 160),
    previewImageUrl: preview?.url ?? null,
    publicPath: freeResourcePublicPath(slug),
    cta: content.cta,
    publishedAt: content.metadata.resourcePublishedAt ?? null,
  };
}

export async function listPublishedFreeResources(
  store: MarketingStore,
): Promise<PublishedFreeResource[]> {
  const [content, assets] = await Promise.all([store.listContent(), store.listAssets()]);
  return content
    .map((item) => mapPublishedFreeResource(item, assets))
    .filter((item): item is PublishedFreeResource => Boolean(item))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

export async function listPublishedFreeResourcesForBook(
  store: MarketingStore,
  bookId: string,
): Promise<PublishedFreeResource[]> {
  const published = await listPublishedFreeResources(store);
  return published.filter((resource) => resource.bookId === bookId);
}

export async function getPublishedFreeResourceBySlug(
  store: MarketingStore,
  slug: string,
): Promise<{
  content: MarketingContent;
  resource: PublishedFreeResource;
  hasDeliverablePreview: boolean;
} | null> {
  const items = await store.listContent();
  const content = items.find(
    (item) => isFreeResourceContent(item) && item.metadata.slug === slug && item.status === "published",
  );
  if (!content) return null;
  const assets = await store.listAssets();
  const resource = mapPublishedFreeResource(content, assets);
  if (!resource) return null;
  return {
    content,
    resource,
    hasDeliverablePreview: hasDeliverableFreeResourcePreview(content, assets),
  };
}
