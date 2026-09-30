"use client";

import {
  calendarDayKeyInMarketingTimezone,
  formatMarketingScheduleDisplay,
} from "@/lib/marketing/marketing-scheduling";
import { useEffect, useState } from "react";
import { Card, StatusPill } from "./ui";

type CalendarEvent = {
  id: string;
  contentId: string;
  publicationId: string;
  platform: string;
  title: string | null;
  status: string;
  scheduledFor: string;
  timezone: string;
};

export function CalendarClient() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [marketingTimezone, setMarketingTimezone] = useState("America/New_York");

  useEffect(() => {
    void fetch("/api/admin/marketing/calendar")
      .then((res) => res.json())
      .then((data) => {
        setEvents(data.events ?? []);
        setMarketingTimezone(data.marketingTimezone ?? "America/New_York");
      });
  }, []);

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = calendarDayKeyInMarketingTimezone(
      event.scheduledFor,
      event.timezone || marketingTimezone,
    );
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }

  const sortedDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-charcoal/70">
        Publishing calendar · scheduled publications · times shown in {marketingTimezone}
      </p>
      {sortedDays.map(([day, dayItems]) => (
        <Card key={day}>
          <h2 className="font-display text-2xl text-brand-navy">{day}</h2>
          <ul className="mt-3 space-y-2">
            {dayItems
              .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
              .map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{event.title || event.platform}</p>
                    <p className="text-xs text-brand-charcoal/60">
                      {event.platform} ·{" "}
                      {formatMarketingScheduleDisplay(
                        event.scheduledFor,
                        event.timezone || marketingTimezone,
                      )}
                    </p>
                  </div>
                  <StatusPill status={event.status} />
                </li>
              ))}
          </ul>
        </Card>
      ))}
      {!events.length ? (
        <p>No scheduled publications yet. Approve and schedule from Your week, or recycle published content.</p>
      ) : null}
    </div>
  );
}
