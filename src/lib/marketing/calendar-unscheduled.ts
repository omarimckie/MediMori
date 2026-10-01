import type { MarketingContent, MarketingPublication } from "./types";

export function hasActiveScheduledPublication(
  publications: Pick<MarketingPublication, "contentId" | "platform" | "status">[],
  contentId: string,
  platform: MarketingContent["platform"],
): boolean {
  return publications.some(
    (publication) =>
      publication.contentId === contentId &&
      publication.platform === platform &&
      publication.status === "scheduled",
  );
}

/** Approved content without an active scheduled publication for its platform. */
export function filterUnscheduledApprovedContent(
  content: MarketingContent[],
  publications: Pick<MarketingPublication, "contentId" | "platform" | "status">[],
): MarketingContent[] {
  return content.filter((item) => {
    if (item.status !== "approved") return false;
    return !hasActiveScheduledPublication(publications, item.id, item.platform);
  });
}
