"use client";

import { useEffect, useState } from "react";
import { Card, StatusPill } from "./ui";

type Item = {
  id: string;
  platform: string;
  title: string | null;
  status: string;
  scheduledFor: string | null;
};

export function CalendarClient() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    void fetch("/api/admin/marketing/content")
      .then((res) => res.json())
      .then((data) => setItems(data.content ?? []));
  }, []);

  const scheduled = items
    .filter((item) => item.scheduledFor)
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));

  const byDay = new Map<string, Item[]>();
  for (const item of scheduled) {
    const day = String(item.scheduledFor).slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }

  return (
    <div className="space-y-4">
      {[...byDay.entries()].map(([day, dayItems]) => (
        <Card key={day}>
          <h2 className="font-display text-2xl text-brand-navy">{day}</h2>
          <ul className="mt-3 space-y-2">
            {dayItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{item.title || item.platform}</p>
                  <p className="text-xs text-brand-charcoal/60">
                    {item.platform} · {item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : ""}
                  </p>
                </div>
                <StatusPill status={item.status} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {!scheduled.length ? <p>No scheduled items yet. Approve and schedule from Your week.</p> : null}
    </div>
  );
}
