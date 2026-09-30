import { getPosts } from "@/lib/blog";
import { getBooks } from "@/lib/books";
import type { PublishedFreeResource } from "@/lib/marketing/free-resources";
import { getSiteUrl } from "@/lib/site";
import type { MetadataRoute } from "next";

export const PUBLIC_STATIC_SITEMAP_PATHS = [
  "/",
  "/books",
  "/authors",
  "/resources",
  "/resources/free",
  "/contact",
  "/blog",
  "/privacy-policy",
  "/terms-of-use",
  "/refund-policy",
] as const;

export function freeResourceSitemapEntries(
  base: string,
  resources: PublishedFreeResource[],
  fallbackDate: Date,
): MetadataRoute.Sitemap {
  return resources
    .filter((resource) => resource.slug.trim().length > 0)
    .map((resource) => ({
      url: `${base}${resource.publicPath}`,
      lastModified: resource.publishedAt ? new Date(resource.publishedAt) : fallbackDate,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    }));
}

export async function buildPublicSitemap(
  listPublishedFreeResources: () => Promise<PublishedFreeResource[]>,
): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_STATIC_SITEMAP_PATHS.map((path) => ({
    url: path === "/" ? base : `${base}${path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/books" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/books" ? 0.9 : 0.7,
  }));

  const bookEntries: MetadataRoute.Sitemap = getBooks().map((book) => ({
    url: `${base}/books/${book.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.95,
  }));

  let blogEntries: MetadataRoute.Sitemap = [];
  try {
    const posts = await getPosts();
    blogEntries = posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: post.publishedAt ? new Date(post.publishedAt) : now,
      changeFrequency: "monthly",
      priority: 0.6,
    }));
  } catch {
    // Blog store may be unavailable at build time; static routes still ship.
  }

  let freeResourceEntries: MetadataRoute.Sitemap = [];
  try {
    const published = await listPublishedFreeResources();
    freeResourceEntries = freeResourceSitemapEntries(base, published, now);
  } catch {
    // Marketing store may be unavailable at build time.
  }

  return [...staticEntries, ...bookEntries, ...blogEntries, ...freeResourceEntries];
}
