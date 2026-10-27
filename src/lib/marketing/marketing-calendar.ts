import { getMarketingTimezone } from "./config";
import { isContentRecyclablePlatform } from "./recycle-eligibility";
import { calendarDayKeyInMarketingTimezone } from "./marketing-scheduling";
import type { MarketingStore } from "./store";
import type { MarketingContent, MarketingPublication } from "./types";

export type MarketingCalendarEventKind = "published" | "scheduled";

export type MarketingCalendarEvent = {
  id: string;
  publicationId: string;
  contentId: string;
  platform: MarketingContent["platform"];
  format: MarketingContent["format"];
  title: string | null;
  bodyExcerpt: string;
  status: MarketingPublication["status"];
  eventKind: MarketingCalendarEventKind;
  /** Instant used for calendar day placement (marketing timezone). */
  placementAt: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  url: string | null;
  isRecycle: boolean;
  timezone: string;
  canRecycle: boolean;
};

export function isRecyclePublicationIdempotencyKey(idempotencyKey: string): boolean {
  return idempotencyKey.includes(":recycle:");
}

function bodyExcerpt(body: string, max = 240): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

function eventFromPublication(
  publication: MarketingPublication,
  content: MarketingContent,
  eventKind: MarketingCalendarEventKind,
  placementAt: string,
): MarketingCalendarEvent {
  const isRecycle = isRecyclePublicationIdempotencyKey(publication.idempotencyKey);
  const canRecycle =
    eventKind === "published" && isContentRecyclablePlatform(content);
  return {
    id: `pub:${publication.id}:${eventKind}`,
    publicationId: publication.id,
    contentId: publication.contentId,
    platform: publication.platform,
    format: content.format,
    title: content.title,
    bodyExcerpt: bodyExcerpt(content.body),
    status: publication.status,
    eventKind,
    placementAt,
    scheduledFor: publication.scheduledFor,
    publishedAt: publication.publishedAt,
    url: publication.url,
    isRecycle,
    timezone: content.timezone || getMarketingTimezone(),
    canRecycle,
  };
}

export function calendarEventsFromPublications(
  publications: MarketingPublication[],
  contentById: Map<string, MarketingContent>,
): MarketingCalendarEvent[] {
  const events: MarketingCalendarEvent[] = [];
  for (const publication of publications) {
    const content = contentById.get(publication.contentId);
    if (!content) continue;

    if (publication.status === "scheduled" && publication.scheduledFor) {
      events.push(
        eventFromPublication(
          publication,
          content,
          "scheduled",
          publication.scheduledFor,
        ),
      );
      continue;
    }

    if (publication.status === "published" && publication.publishedAt) {
      events.push(
        eventFromPublication(
          publication,
          content,
          "published",
          publication.publishedAt,
        ),
      );
    }
  }
  return events.sort((a, b) => a.placementAt.localeCompare(b.placementAt));
}

export function calendarDayKeyForEvent(
  event: MarketingCalendarEvent,
  marketingTimezone: string,
): string {
  return calendarDayKeyInMarketingTimezone(event.placementAt, event.timezone || marketingTimezone);
}

export async function listMarketingCalendarEvents(
  store: MarketingStore,
): Promise<MarketingCalendarEvent[]> {
  const [scheduled, published, content] = await Promise.all([
    store.listPublications("scheduled"),
    store.listPublications("published"),
    store.listContent(),
  ]);
  const contentById = new Map(content.map((item) => [item.id, item]));
  return calendarEventsFromPublications([...scheduled, ...published], contentById);
}
