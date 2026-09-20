import { formatAspectRatioLabel, truthFromDimensions, type AssetImageTruth } from "./asset-truth";

/** Normalize site-relative asset URLs for manifest lookup. */
export function normalizeCatalogAssetUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const pathOnly = trimmed.startsWith("http")
      ? new URL(trimmed).pathname
      : trimmed.startsWith("/")
        ? trimmed
        : `/${trimmed}`;
    return decodeURIComponent(pathOnly).replace(/\\/g, "/").toLowerCase();
  } catch {
    return decodeURIComponent(trimmed).toLowerCase();
  }
}

/**
 * Committed storefront catalog dimensions (source: probed public files).
 * Used when persisting catalog truth without filesystem access (e.g. serverless sync).
 */
const CATALOG_TRUTH_BY_PATH: Record<
  string,
  { width: number; height: number; mimeType: string }
> = {
  "/amara-waving.png": { width: 522, height: 961, mimeType: "image/png" },
  "/aj-waving.png": { width: 800, height: 1870, mimeType: "image/png" },
  "/covers/sickle-cell.png": { width: 1009, height: 1024, mimeType: "image/png" },
  "/covers/asthma.png": { width: 1024, height: 1024, mimeType: "image/png" },
  "/covers/word search.jpg": { width: 842, height: 1080, mimeType: "image/jpeg" },
  "/previews/sickle-inside-1.png": { width: 1009, height: 1024, mimeType: "image/png" },
  "/previews/sickle-inside-2.png": { width: 1009, height: 1024, mimeType: "image/png" },
  "/previews/sickle-inside-3.png": { width: 1009, height: 1024, mimeType: "image/png" },
  "/previews/asthma-inside-1.png": { width: 1024, height: 1024, mimeType: "image/png" },
  "/previews/asthma-inside-2.png": { width: 1024, height: 1024, mimeType: "image/png" },
  "/previews/asthma-inside-3.png": { width: 1024, height: 512, mimeType: "image/png" },
  "/previews/word-search-inside-1.png": { width: 791, height: 1024, mimeType: "image/png" },
  "/previews/word-search-inside-2.png": { width: 791, height: 1024, mimeType: "image/png" },
  "/previews/word-search-inside-3.png": { width: 791, height: 1024, mimeType: "image/png" },
};

export function catalogTruthFromManifest(url: string | null | undefined): AssetImageTruth | null {
  if (!url?.trim()) return null;
  const key = normalizeCatalogAssetUrl(url);
  const entry = CATALOG_TRUTH_BY_PATH[key];
  if (!entry) return null;
  return truthFromDimensions(entry.width, entry.height, entry.mimeType);
}

export function catalogTruthFieldsFromManifest(url: string | null | undefined) {
  const truth = catalogTruthFromManifest(url);
  if (!truth) return null;
  return {
    imageWidth: truth.width,
    imageHeight: truth.height,
    mimeType: truth.mimeType,
    aspectRatio: formatAspectRatioLabel(truth.width, truth.height),
  };
}
