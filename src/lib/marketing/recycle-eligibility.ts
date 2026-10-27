import type { MarketingContent, Platform } from "./types";

export const RECYCLABLE_PLATFORMS = new Set<Platform>([
  "instagram",
  "facebook",
  "pinterest",
]);

export function isContentRecyclablePlatform(
  content: Pick<MarketingContent, "platform" | "format">,
): boolean {
  if (content.platform === "website" && content.format === "free_resource") return false;
  if (content.platform === "email") return false;
  return RECYCLABLE_PLATFORMS.has(content.platform);
}

export type ReviewCardRecycleEligibility = {
  status: string;
  platform: MarketingContent["platform"];
  format: MarketingContent["format"];
  hasPublishedPublication: boolean;
};

/** Whether the weekly review card should offer Recycle (UI only; API re-validates). */
export function shouldShowRecycleOnReviewCard(input: ReviewCardRecycleEligibility): boolean {
  if (input.status !== "published") return false;
  if (!isContentRecyclablePlatform({ platform: input.platform, format: input.format })) {
    return false;
  }
  return input.hasPublishedPublication;
}
