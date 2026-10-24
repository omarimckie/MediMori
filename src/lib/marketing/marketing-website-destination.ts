import blogData from "@/data/blog.json";
import { getBooks } from "@/lib/books";
import { absoluteUrl } from "@/lib/site";
import {
  freeResourcePublicPath,
  isFreeResourceContent,
  isPublicFreeResourceSlug,
} from "./content-metadata";
import {
  buildWebsiteDestinationDiagnostics,
  type PlatformLinkBehavior,
  type WebsiteDestinationIssue,
  type WebsiteDestinationReadiness,
} from "./marketing-website-destination-diagnostics";
import { buildPublishTrackingLink } from "./tracking";
import type { ContentCategory, MarketingContent, Platform } from "./types";

export type {
  MarketingWebsiteDestinationDiagnostics,
  PlatformLinkBehavior,
  WebsiteDestinationIssue,
  WebsiteDestinationReadiness,
} from "./marketing-website-destination-diagnostics";

const KNOWN_BOOK_IDS = new Set(getBooks().map((book) => book.id));
const KNOWN_BLOG_SLUGS = new Set(
  (blogData.posts as Array<{ slug: string }>).map((post) => post.slug),
);

/** Categories that promote the brand site generally rather than a single book page. */
const HOMEPAGE_CATEGORIES = new Set<ContentCategory>([
  "brand_story",
  "community",
  "trust",
]);

export type MarketingWebsiteDestinationReview = {
  destinationPath: string;
  sitePageUrl: string;
  trackingLink: string | null;
  platformNavigationSummary: string;
  warnings: string[];
  readiness: WebsiteDestinationReadiness;
  publishBlocked: boolean;
  issues: WebsiteDestinationIssue[];
  recoveryHints: string[];
  platformLinkBehavior: PlatformLinkBehavior;
  trackingTokenPresent: boolean;
  grandfatheredWithoutTrackedLink: boolean;
};

function normalizeInternalPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("://") || trimmed.includes("..")) return null;
  if (trimmed.includes("?") || trimmed.includes("#")) return null;
  if (/\/\/+/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed, "https://twilight-feather.example");
    if (parsed.origin !== "https://twilight-feather.example") return null;
    return parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

export function isApprovedMarketingDestinationPath(path: string): boolean {
  const normalized = normalizeInternalPath(path);
  if (!normalized) return false;
  if (normalized === "/" || normalized === "/books") return true;
  if (normalized.startsWith("/books/")) {
    const bookId = normalized.slice("/books/".length);
    return KNOWN_BOOK_IDS.has(bookId) && !bookId.includes("/");
  }
  if (normalized.startsWith("/blog/")) {
    const slug = normalized.slice("/blog/".length);
    return KNOWN_BLOG_SLUGS.has(slug) && !slug.includes("/");
  }
  if (normalized.startsWith("/resources/free/")) {
    const slug = normalized.slice("/resources/free/".length);
    return isPublicFreeResourceSlug(slug) && !slug.includes("/");
  }
  return false;
}

function metadataDestinationOverride(content: MarketingContent): string | null {
  const raw = content.metadata?.websiteDestinationPath;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const normalized = normalizeInternalPath(raw);
  if (!normalized || !isApprovedMarketingDestinationPath(normalized)) return null;
  return normalized;
}

/**
 * Resolves the on-site path used by /api/m redirects (UTM params are added at redirect time).
 */
export function resolveMarketingWebsiteDestinationPath(content: MarketingContent | null): string {
  if (!content) return "/";
  const override = metadataDestinationOverride(content);
  if (override) return override;

  if (isFreeResourceContent(content)) {
    const slug = content.metadata?.slug?.trim();
    if (slug && isPublicFreeResourceSlug(slug)) {
      const path = freeResourcePublicPath(slug);
      if (isApprovedMarketingDestinationPath(path)) return path;
    }
  }

  const bookId = content.bookId?.trim();
  const hasKnownBook = bookId ? KNOWN_BOOK_IDS.has(bookId) : false;
  if (hasKnownBook && !HOMEPAGE_CATEGORIES.has(content.category)) {
    return `/books/${bookId}`;
  }

  return "/";
}

export function platformWebsiteNavigationSummary(
  platform: Platform,
  hasImagePost: boolean,
): string {
  if (platform === "pinterest") {
    return "Pinterest pin link uses the tracked /api/m URL (clickable destination on the pin).";
  }
  if (platform === "facebook") {
    if (hasImagePost) {
      return "Facebook photo post: tracked URL is appended to the caption (photo API does not accept a separate link field).";
    }
    return "Facebook text post: tracked URL is sent as the feed link parameter for one-tap navigation.";
  }
  if (platform === "instagram") {
    return "Instagram feed: tracked URL is appended to the caption; feed URLs are not clickable (copy/link-in-bio only).";
  }
  return "Tracked redirect applies when a tracking token is configured.";
}

const TRACKED_SOCIAL_PLATFORMS = new Set<Platform>(["facebook", "instagram", "pinterest"]);

/** Legacy rows already scheduled or published without tokens keep working; new posts must have links. */
export function socialContentGrandfatheredWithoutTrackedLink(content: MarketingContent): boolean {
  if (content.trackingToken?.trim()) return false;
  if (!TRACKED_SOCIAL_PLATFORMS.has(content.platform)) return false;
  return content.status === "scheduled" || content.status === "published";
}

export function platformRequiresTrackedWebsiteLink(platform: Platform): boolean {
  return TRACKED_SOCIAL_PLATFORMS.has(platform);
}

export type TrackedDestinationPublishIssueCode =
  | "tracking_token_missing"
  | "destination_path_invalid"
  | "tracking_url_build_failed";

export function marketingDestinationOverrideRejected(content: MarketingContent): boolean {
  const raw = content.metadata?.websiteDestinationPath;
  if (typeof raw !== "string" || !raw.trim()) return false;
  return metadataDestinationOverride(content) === null;
}

export function validateTrackedWebsiteDestinationForPublish(
  content: MarketingContent,
):
  | { ok: true }
  | { ok: false; code: TrackedDestinationPublishIssueCode; message: string } {
  const token = content.trackingToken?.trim();
  if (!token) {
    return {
      ok: false,
      code: "tracking_token_missing",
      message:
        "A tracking token is required before this post can be scheduled or published with a website link. Approve weekly content that includes tracking, or restore a token on this row.",
    };
  }
  const destinationPath = resolveMarketingWebsiteDestinationPath(content);
  if (!isApprovedMarketingDestinationPath(destinationPath)) {
    return {
      ok: false,
      code: "destination_path_invalid",
      message:
        "The resolved website destination is not on the approved Twilight Feather path allowlist. Use a valid book, blog slug, free resource, or homepage category mapping.",
    };
  }
  if (!buildPublishTrackingLink(content)) {
    return {
      ok: false,
      code: "tracking_url_build_failed",
      message: "Could not build the public /api/m tracking URL for this content.",
    };
  }
  return { ok: true };
}

export function buildMarketingWebsiteDestinationReview(
  content: MarketingContent,
  options?: { hasImagePost?: boolean },
): MarketingWebsiteDestinationReview {
  const destinationPath = resolveMarketingWebsiteDestinationPath(content);
  const sitePageUrl = absoluteUrl(destinationPath);
  const trackingLink = buildPublishTrackingLink(content);
  const hasImage =
    options?.hasImagePost ??
    (content.platform === "facebook" || content.platform === "instagram");

  const diagnostics = buildWebsiteDestinationDiagnostics({
    content,
    hasImagePost: hasImage,
    destinationPath,
    destinationAllowlisted: isApprovedMarketingDestinationPath(destinationPath),
    trackingLink,
    overrideRejected: marketingDestinationOverrideRejected(content),
    grandfatheredWithoutTrackedLink: socialContentGrandfatheredWithoutTrackedLink(content),
  });
  const warnings = diagnostics.issues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => issue.message);

  return {
    destinationPath,
    sitePageUrl,
    trackingLink,
    platformNavigationSummary: platformWebsiteNavigationSummary(content.platform, hasImage),
    warnings,
    readiness: diagnostics.readiness,
    publishBlocked: diagnostics.publishBlocked,
    issues: diagnostics.issues,
    recoveryHints: diagnostics.recoveryHints,
    platformLinkBehavior: diagnostics.platformLinkBehavior,
    trackingTokenPresent: diagnostics.trackingTokenPresent,
    grandfatheredWithoutTrackedLink: diagnostics.grandfatheredWithoutTrackedLink,
  };
}
