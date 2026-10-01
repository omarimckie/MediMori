import { isContentRecyclablePlatform } from "./recycle-eligibility";
import type { MarketingCalendarEvent } from "./marketing-calendar";
import type { MarketingContent } from "./types";

export type CalendarPublicationDetailEligibility = Pick<
  MarketingCalendarEvent,
  "eventKind" | "canRecycle"
>;

/** Whether the calendar detail modal should show Recycle (UI only; API re-validates). */
export function calendarDetailShowsRecycle(event: CalendarPublicationDetailEligibility): boolean {
  return event.eventKind === "published" && event.canRecycle;
}

export function calendarPublishedNonRecyclableMessage(
  content: Pick<MarketingContent, "platform" | "format">,
): string {
  if (content.platform === "email") {
    return "Email content cannot be recycled from the calendar.";
  }
  if (content.platform === "website" && content.format === "free_resource") {
    return "Free resource pages cannot be recycled from the calendar.";
  }
  return "This content type cannot be recycled from the calendar.";
}

export function calendarEventShowsRecycleBadge(
  event: Pick<MarketingCalendarEvent, "eventKind" | "isRecycle" | "canRecycle">,
): boolean {
  if (event.eventKind === "scheduled" && event.isRecycle) return true;
  return false;
}

export function calendarEventStatusLabel(
  event: Pick<MarketingCalendarEvent, "eventKind" | "isRecycle">,
): string {
  if (event.eventKind === "published") return "Published";
  if (event.isRecycle) return "Scheduled · Recycle";
  return "Scheduled";
}

/** Mirror server recycle platform rules for display tests. */
export { isContentRecyclablePlatform };
