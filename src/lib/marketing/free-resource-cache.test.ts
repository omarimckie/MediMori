import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { freeResourcePublicPath, isPublicFreeResourceSlug } from "./content-metadata";
import {
  revalidatePublishedFreeResourcePaths,
  setRevalidatePathForTests,
} from "./free-resource-cache";

afterEach(() => {
  setRevalidatePathForTests(null);
});

test("isPublicFreeResourceSlug accepts production-style slugs", () => {
  assert.equal(isPublicFreeResourceSlug("healthy-habits-word-search"), true);
  assert.equal(isPublicFreeResourceSlug("asthma-breathing-easy-activity-sheet"), true);
});

test("isPublicFreeResourceSlug rejects unsafe or invalid slugs", () => {
  assert.equal(isPublicFreeResourceSlug(""), false);
  assert.equal(isPublicFreeResourceSlug("   "), false);
  assert.equal(isPublicFreeResourceSlug("../escape"), false);
  assert.equal(isPublicFreeResourceSlug("bad/slug"), false);
  assert.equal(isPublicFreeResourceSlug("Upper-Case"), false);
  assert.equal(isPublicFreeResourceSlug("has spaces"), false);
});

test("revalidatePublishedFreeResourcePaths targets collection, hub, sitemap, and detail", () => {
  const paths: string[] = [];
  setRevalidatePathForTests((path) => {
    paths.push(path);
  });
  const slug = "healthy-habits-word-search";
  revalidatePublishedFreeResourcePaths(slug);
  assert.deepEqual(paths, [
    "/resources/free",
    "/resources",
    "/sitemap.xml",
    freeResourcePublicPath(slug),
  ]);
});

test("revalidatePublishedFreeResourcePaths skips detail path for invalid slug", () => {
  const paths: string[] = [];
  setRevalidatePathForTests((path) => {
    paths.push(path);
  });
  revalidatePublishedFreeResourcePaths("../evil");
  assert.deepEqual(paths, ["/resources/free", "/resources", "/sitemap.xml"]);
});

test("revalidatePublishedFreeResourcePaths does not throw when revalidate fails", () => {
  setRevalidatePathForTests(() => {
    throw new Error("revalidate unavailable");
  });
  revalidatePublishedFreeResourcePaths("healthy-habits-word-search");
});
