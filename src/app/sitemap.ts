import { getPosts } from "@/lib/blog";
import { getBooks } from "@/lib/books";
import { getSiteUrl } from "@/lib/site";
import type { MetadataRoute } from "next";

const STATIC_PATHS = [
  "/",
  "/books",
  "/authors",
  "/resources",
  "/contact",
  "/blog",
  "/privacy-policy",
  "/terms-of-use",
  "/refund-policy",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
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

  return [...staticEntries, ...bookEntries, ...blogEntries];
}
