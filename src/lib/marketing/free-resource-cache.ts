import { revalidatePath } from "next/cache";
import { freeResourcePublicPath, isPublicFreeResourceSlug } from "./content-metadata";
import { logMarketing } from "./logger";

type RevalidatePathFn = (path: string) => void;

const PUBLISHED_FREE_RESOURCE_STATIC_PATHS = [
  "/resources/free",
  "/resources",
  "/sitemap.xml",
] as const;

let revalidatePathForTests: RevalidatePathFn | null = null;

/** Test seam — avoids `next/cache` in unit tests. */
export function setRevalidatePathForTests(fn: RevalidatePathFn | null): void {
  revalidatePathForTests = fn;
}

function callRevalidatePath(path: string): void {
  const revalidate = revalidatePathForTests ?? revalidatePath;
  revalidate(path);
}

/**
 * Invalidate public routes that depend on the published free-resource catalog.
 * Always revalidates collection, resources hub, and sitemap; revalidates the detail
 * page only when {@link slug} is a valid public resource slug.
 */
export function revalidatePublishedFreeResourcePaths(slug: string): void {
  try {
    for (const path of PUBLISHED_FREE_RESOURCE_STATIC_PATHS) {
      callRevalidatePath(path);
    }
    const normalized = slug.trim();
    if (isPublicFreeResourceSlug(normalized)) {
      callRevalidatePath(freeResourcePublicPath(normalized));
    }
  } catch (error) {
    logMarketing({
      operation: "revalidate_free_resource_cache",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
