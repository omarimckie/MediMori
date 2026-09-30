import type { MarketingPublication } from "./types";

const ACTIVE_STATUS_RANK: Record<MarketingPublication["status"], number> = {
  processing: 0,
  scheduled: 1,
  failed: 2,
  queued: 3,
  published: 4,
};

type PublicationPickFields = Pick<
  MarketingPublication,
  "contentId" | "status" | "createdAt"
>;

/** Pick the publication row that best represents current UI state for a content item. */
export function pickPrimaryPublication<T extends PublicationPickFields>(
  publications: T[],
  contentId: string,
): T | null {
  const forContent = publications.filter((row) => row.contentId === contentId);
  if (!forContent.length) return null;

  return [...forContent].sort((a, b) => {
    const rankA = ACTIVE_STATUS_RANK[a.status];
    const rankB = ACTIVE_STATUS_RANK[b.status];
    if (rankA !== rankB) return rankA - rankB;
    return b.createdAt.localeCompare(a.createdAt);
  })[0];
}
