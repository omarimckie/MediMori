"use client";

import {
  calendarDetailShowsRecycle,
  calendarPublishedNonRecyclableMessage,
  calendarEventStatusLabel,
} from "@/lib/marketing/calendar-publication-eligibility";
import type { MarketingCalendarEvent } from "@/lib/marketing/marketing-calendar";
import { formatMarketingScheduleDisplay } from "@/lib/marketing/marketing-scheduling";
import { PrimaryButton, SecondaryButton, StatusPill } from "./ui";

type Props = {
  event: MarketingCalendarEvent;
  marketingTimezone: string;
  busy: boolean;
  onClose: () => void;
  onRecycle: () => void;
};

export function CalendarPublicationDetailModal({
  event,
  marketingTimezone,
  busy,
  onClose,
  onRecycle,
}: Props) {
  const tz = event.timezone || marketingTimezone;
  const showRecycle = calendarDetailShowsRecycle(event);
  const statusLabel = calendarEventStatusLabel(event);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/40 p-4">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-xl"
        role="dialog"
        aria-labelledby="calendar-pub-detail-title"
      >
        <h2 id="calendar-pub-detail-title" className="font-display text-2xl text-brand-navy">
          {event.title || event.platform}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill status={event.eventKind === "published" ? "published" : "scheduled"} />
          <span className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
            {statusLabel}
          </span>
          {event.isRecycle ? (
            <span
              className="rounded-full border border-brand-navy/30 bg-brand-lavender/30 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-navy"
              aria-label="Recycle publication"
            >
              Recycle
            </span>
          ) : null}
          <span className="text-sm text-brand-charcoal/70">{event.platform}</span>
        </div>

        <dl className="mt-4 space-y-2 text-sm text-brand-charcoal">
          {event.publishedAt ? (
            <div>
              <dt className="font-bold">Published</dt>
              <dd>{formatMarketingScheduleDisplay(event.publishedAt, tz)}</dd>
            </div>
          ) : null}
          {event.scheduledFor ? (
            <div>
              <dt className="font-bold">Scheduled for</dt>
              <dd>{formatMarketingScheduleDisplay(event.scheduledFor, tz)}</dd>
            </div>
          ) : null}
          {event.url ? (
            <div>
              <dt className="font-bold">Live URL</dt>
              <dd>
                <a
                  href={event.url}
                  className="break-all font-semibold text-brand-green-deep underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.url}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {event.bodyExcerpt ? (
          <p className="mt-4 text-sm leading-relaxed text-brand-charcoal/80">{event.bodyExcerpt}</p>
        ) : null}

        {event.eventKind === "published" && !showRecycle ? (
          <p className="mt-4 text-sm text-brand-charcoal/70">
            {calendarPublishedNonRecyclableMessage({
              platform: event.platform,
              format: event.format,
            })}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>
            Close
          </SecondaryButton>
          {showRecycle ? (
            <PrimaryButton type="button" disabled={busy} onClick={onRecycle}>
              Recycle
            </PrimaryButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
