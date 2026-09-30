"use client";

import {
  calendarDayKeyInMarketingTimezone,
  formatMarketingScheduleDisplay,
} from "@/lib/marketing/marketing-scheduling";
import { useEffect, useState } from "react";
import { Card, StatusPill } from "./ui";

type Item = {
  id: string;
  platform: string;
  title: string | null;
  status: string;
  scheduledFor: string | null;
  timezone: string;
};

export function CalendarClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [marketingTimezone, setMarketingTimezone] = useState("America/New_York");

  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/marketing/content").then((res) => res.json()),
      fetch("/api/admin/marketing/settings").then((res) => res.json()),
    ]).then(([contentData, settingsData]) => {
      setItems(contentData.content ?? []);
      setMarketingTimezone(settingsData.marketingTimezone ?? "America/New_York");
    });
  }, []);

  const calendarItems = items
    .filter((item) => item.scheduledFor)
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));

  const byDay = new Map<string, Item[]>();
  for (const item of calendarItems) {
    const day = calendarDayKeyInMarketingTimezone(
      String(item.scheduledFor),
      item.timezone || marketingTimezone,
    );
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-charcoal/70">
        Publishing calendar · times shown in {marketingTimezone}
      </p>
      {[...byDay.entries()].map(([day, dayItems]) => (
        <Card key={day}>
          <h2 className="font-display text-2xl text-brand-navy">{day}</h2>
          <ul className="mt-3 space-y-2">
            {dayItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{item.title || item.platform}</p>
                  <p className="text-xs text-brand-charcoal/60">
                    {item.platform} ·{" "}
                    {item.scheduledFor
                      ? formatMarketingScheduleDisplay(
                          item.scheduledFor,
                          item.timezone || marketingTimezone,
                        )
                      : ""}
                  </p>
                </div>
                <StatusPill status={item.status} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {!calendarItems.length ? (
        <p>No scheduled items yet. Approve and schedule from Your week.</p>
      ) : null}
    </div>
  );
}
