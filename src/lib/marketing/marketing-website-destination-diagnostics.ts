import { getBooks } from "@/lib/books";
import type { MarketingContent, Platform } from "./types";

const KNOWN_BOOK_IDS = new Set(getBooks().map((book) => book.id));

/** Tokens minted by the content engine are 16 lowercase hex characters. */
export const MARKETING_TRACKING_TOKEN_PATTERN = /^[a-f0-9]{16}$/;

export type WebsiteDestinationReadiness = "ready" | "warning" | "blocked";

export type WebsiteDestinationIssueCode =
  | "tracking_token_missing"
  | "tracking_token_nonstandard"
  | "destination_path_not_allowlisted"
  | "destination_override_rejected"
  | "unknown_book_for_destination"
  | "tracking_url_build_failed"
  | "grandfathered_without_tracked_link"
  | "instagram_caption_link_only"
  | "facebook_image_caption_link"
  | "pinterest_clickable_pin_link";

export type WebsiteDestinationIssue = {
  code: WebsiteDestinationIssueCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type PlatformLinkBehavior =
  | "clickable_destination"
  | "feed_link_field"
  | "caption_text_only";

export type MarketingWebsiteDestinationDiagnostics = {
  readiness: WebsiteDestinationReadiness;
  publishBlocked: boolean;
  issues: WebsiteDestinationIssue[];
  recoveryHints: string[];
  platformLinkBehavior: PlatformLinkBehavior;
  trackingTokenPresent: boolean;
  grandfatheredWithoutTrackedLink: boolean;
};

function platformLinkBehavior(
  platform: Platform,
  hasImagePost: boolean,
): PlatformLinkBehavior {
  if (platform === "pinterest") return "clickable_destination";
  if (platform === "facebook" && !hasImagePost) return "feed_link_field";
  if (platform === "facebook" || platform === "instagram") return "caption_text_only";
  return "caption_text_only";
}

function recoveryHintsForIssues(issues: WebsiteDestinationIssue[]): string[] {
  const hints = new Set<string>();
  for (const issue of issues) {
    switch (issue.code) {
      case "tracking_token_missing":
        hints.add(
          "Approve weekly content with tracking enabled or assign a tracking token before scheduling new social posts.",
        );
        break;
      case "tracking_token_nonstandard":
        hints.add(
          "Non-standard tokens may still redirect if present in the database; new content should use 16-character hex tokens from approval.",
        );
        break;
      case "destination_path_not_allowlisted":
      case "destination_override_rejected":
        hints.add(
          "Use /, /books/{id}, /blog/{slug}, or /resources/free/{slug} — no query strings or external URLs.",
        );
        break;
      case "unknown_book_for_destination":
        hints.add("Set bookId to a catalog book or switch category to a homepage-style post.");
        break;
      case "tracking_url_build_failed":
        hints.add("Ensure NEXT_PUBLIC_SITE_URL is configured so /api/m links can be built.");
        break;
      case "grandfathered_without_tracked_link":
        hints.add(
          "Legacy scheduled/published rows may publish without a token; add tracking before recycling or cloning this row.",
        );
        break;
      case "instagram_caption_link_only":
        hints.add("Plan link-in-bio or spell out the URL; Instagram feed links are not tappable.");
        break;
      case "facebook_image_caption_link":
        hints.add("Put the tracked URL in the caption; viewers must tap the text link, not a link preview card.");
        break;
      case "pinterest_clickable_pin_link":
        hints.add("Confirm the pin preview shows the tracked /api/m URL as the destination.");
        break;
      default:
        break;
    }
  }
  return [...hints];
}

export type WebsiteDestinationDiagnosticsInput = {
  content: MarketingContent;
  hasImagePost: boolean;
  destinationPath: string;
  destinationAllowlisted: boolean;
  trackingLink: string | null;
  overrideRejected: boolean;
  grandfatheredWithoutTrackedLink: boolean;
};

/**
 * Read-only destination diagnostics for admin review (does not mutate content or call external APIs).
 */
export function buildWebsiteDestinationDiagnostics(
  input: WebsiteDestinationDiagnosticsInput,
): MarketingWebsiteDestinationDiagnostics {
  const {
    content,
    hasImagePost,
    destinationPath,
    destinationAllowlisted,
    trackingLink,
    overrideRejected,
    grandfatheredWithoutTrackedLink: grandfathered,
  } = input;
  const token = content.trackingToken?.trim() ?? "";
  const trackingTokenPresent = Boolean(token);
  const issues: WebsiteDestinationIssue[] = [];

  const linkBehavior = platformLinkBehavior(content.platform, hasImagePost);

  if (linkBehavior === "clickable_destination") {
    issues.push({
      code: "pinterest_clickable_pin_link",
      severity: "info",
      message: "Pinterest uses the tracked /api/m URL as the pin's clickable destination.",
    });
  } else if (content.platform === "facebook" && hasImagePost) {
    issues.push({
      code: "facebook_image_caption_link",
      severity: "warning",
      message:
        "Facebook photo posts only expose the tracked URL in the caption (not a separate link attachment).",
    });
  }

  if (content.platform === "instagram") {
    issues.push({
      code: "instagram_caption_link_only",
      severity: "warning",
      message: "Instagram feed URLs in captions are not clickable; viewers copy the link or use link-in-bio.",
    });
  }

  if (grandfathered) {
    issues.push({
      code: "grandfathered_without_tracked_link",
      severity: "warning",
      message:
        "This row is grandfathered: scheduled or published without a tracking token under pre-link rules.",
    });
  }

  if (!trackingTokenPresent && !grandfathered) {
    issues.push({
      code: "tracking_token_missing",
      severity: "error",
      message: "No tracking token — scheduling and publish preflight will block website link delivery.",
    });
  } else if (trackingTokenPresent && !MARKETING_TRACKING_TOKEN_PATTERN.test(token)) {
    issues.push({
      code: "tracking_token_nonstandard",
      severity: "warning",
      message: "Tracking token is not the standard 16-character hex format used for new weekly content.",
    });
  }

  if (overrideRejected) {
    issues.push({
      code: "destination_override_rejected",
      severity: "error",
      message:
        "metadata.websiteDestinationPath was rejected (must be an approved on-site path without query strings).",
    });
  }

  if (!destinationAllowlisted) {
    issues.push({
      code: "destination_path_not_allowlisted",
      severity: "error",
      message: `Resolved destination ${destinationPath} is not on the Twilight Feather path allowlist.`,
    });
  }

  const bookId = content.bookId?.trim();
  if (bookId && !KNOWN_BOOK_IDS.has(bookId) && destinationPath.startsWith("/books/")) {
    issues.push({
      code: "unknown_book_for_destination",
      severity: "error",
      message: `bookId "${bookId}" is not in the catalog; destination may fall back to homepage.`,
    });
  }

  if (trackingTokenPresent && !trackingLink) {
    issues.push({
      code: "tracking_url_build_failed",
      severity: "error",
      message: "Could not build the public /api/m tracking URL (check site URL configuration).",
    });
  }

  const trackingGateFailed =
    !trackingTokenPresent || !destinationAllowlisted || (trackingTokenPresent && !trackingLink);
  const publishBlocked = !grandfathered && (trackingGateFailed || overrideRejected);

  let readiness: WebsiteDestinationReadiness = "ready";
  if (publishBlocked) {
    readiness = "blocked";
  } else if (issues.some((i) => i.severity === "warning" || i.severity === "error") || grandfathered) {
    readiness = "warning";
  }

  return {
    readiness,
    publishBlocked,
    issues,
    recoveryHints: recoveryHintsForIssues(issues),
    platformLinkBehavior: linkBehavior,
    trackingTokenPresent,
    grandfatheredWithoutTrackedLink: grandfathered,
  };
}
