import type { MarketingStore } from "./store";
import type { MarketingContent, MarketingPublication } from "./types";

export type MarketingCalendarEvent = {
  id: string;
  contentId: string;
  publicationId: string;
  platform: string;
  title: string | null;
  status: string;
  scheduledFor: string;
  timezone: string;
};

export function calendarEventsFromPublications(
  publications: MarketingPublication[],
  contentById: Map<string, MarketingContent>,
): MarketingCalendarEvent[] {
  const events: MarketingCalendarEvent[] = [];
  for (const publication of publications) {
    if (publication.status !== "scheduled" || !publication.scheduledFor) continue;
    const content = contentById.get(publication.contentId);
    if (!content) continue;
    events.push({
      id: `pub:${publication.id}`,
      contentId: publication.contentId,
      publicationId: publication.id,
      platform: publication.platform,
      title: content.title,
      status: publication.status,
      scheduledFor: publication.scheduledFor,
      timezone: content.timezone,
    });
  }
  return events.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

export async function listMarketingCalendarEvents(
  store: MarketingStore,
): Promise<MarketingCalendarEvent[]> {
  const [publications, content] = await Promise.all([
    store.listPublications("scheduled"),
    store.listContent(),
  ]);
  const contentById = new Map(content.map((item) => [item.id, item]));
  return calendarEventsFromPublications(publications, contentById);
}
