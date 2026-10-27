import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublishedFreeResource } from "@/lib/marketing/free-resources";
import { freeResourceSitemapEntries, PUBLIC_STATIC_SITEMAP_PATHS } from "./public-sitemap";

const base = "https://twilight-feather.com";

function sampleResource(overrides: Partial<PublishedFreeResource> = {}): PublishedFreeResource {
  return {
    id: "res-1",
    slug: "sickle-cell-coloring",
    title: "Sickle Cell Coloring Page",
    description: "Activity",
    resourceType: "coloring_page",
    resourceTypeLabel: "Coloring page",
    bookId: "book-one",
    bookTitle: "Book",
    relatedCondition: null,
    seoTitle: "SEO",
    seoDescription: "SEO desc",
    previewImageUrl: null,
    publicPath: "/resources/free/sickle-cell-coloring",
    cta: null,
    publishedAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

test("published free resource appears in sitemap entries", () => {
  const fallback = new Date("2026-01-01T00:00:00.000Z");
  const entries = freeResourceSitemapEntries(base, [sampleResource()], fallback);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.url, `${base}/resources/free/sickle-cell-coloring`);
});

test("unpublished resources are not passed into freeResourceSitemapEntries", () => {
  const entries = freeResourceSitemapEntries(base, [], new Date());
  assert.equal(entries.length, 0);
});

test("free resource sitemap uses publication timestamp for lastModified", () => {
  const publishedAt = "2026-03-01T12:00:00.000Z";
  const entries = freeResourceSitemapEntries(
    base,
    [sampleResource({ publishedAt })],
    new Date("2026-01-01T00:00:00.000Z"),
  );
  const lastModified = entries[0]?.lastModified;
  assert.ok(lastModified instanceof Date);
  assert.equal(lastModified.toISOString(), new Date(publishedAt).toISOString());
});

test("free resource sitemap skips invalid slugs", () => {
  const entries = freeResourceSitemapEntries(
    base,
    [sampleResource({ slug: "   ", publicPath: "/resources/free/" })],
    new Date(),
  );
  assert.equal(entries.length, 0);
});

test("public static sitemap paths include free resources collection", () => {
  assert.ok(PUBLIC_STATIC_SITEMAP_PATHS.includes("/resources/free"));
});
