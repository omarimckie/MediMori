"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  severity: string;
  destination: string;
  createdAt: string;
  readAt: string | null;
  relatedIncidentId: string | null;
};

export function MarketingNotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/marketing/notifications");
    if (!res.ok) return;
    const data = (await res.json()) as {
      notifications: NotificationRow[];
      unreadCount: number;
    };
    setItems(data.notifications ?? []);
    setUnreadCount(data.unreadCount ?? 0);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markRead(id: string) {
    await fetch(`/api/admin/marketing/notifications/${id}/read`, { method: "POST" });
    await load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-3 text-sm font-bold text-brand-charcoal hover:bg-cream-deep"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Notifications
        {unreadCount > 0 ? (
          <span className="ml-2 inline-flex min-w-[1.25rem] justify-center rounded-full bg-brand-orange-deep px-1.5 py-0.5 text-xs font-extrabold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="fixed inset-x-3 top-[5.5rem] z-50 w-auto max-w-none rounded-2xl border border-brand-brown/15 bg-white p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(24rem,calc(100vw-2rem))]"
          role="dialog"
          aria-label="Recent notifications"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              Recent
            </p>
            <Link
              href="/admin/marketing/notifications"
              className="text-xs font-bold text-brand-blue-deep"
              onClick={() => setOpen(false)}
            >
              Settings
            </Link>
          </div>
          <ul className="max-h-[min(20rem,60vh)] space-y-2 overflow-y-auto overflow-x-hidden overscroll-contain sm:max-h-80">
            {items.length ? (
              items.slice(0, 8).map((item) => (
                <li
                  key={item.id}
                  className={`rounded-xl border p-2 text-sm ${
                    item.readAt ? "border-brand-brown/10" : "border-brand-gold/40 bg-brand-gold/10"
                  }`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 break-words font-bold text-brand-navy">{item.title}</p>
                    <span className="text-[10px] font-bold uppercase text-brand-charcoal/50">
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-brand-charcoal/75 line-clamp-2">{item.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={item.destination}
                      className="text-xs font-bold text-brand-green-deep"
                      onClick={() => void markRead(item.id)}
                    >
                      Open
                    </Link>
                    {item.relatedIncidentId ? (
                      <Link
                        href={`/admin/marketing/incidents/${item.relatedIncidentId}`}
                        className="text-xs font-bold text-brand-navy"
                        onClick={() => void markRead(item.id)}
                      >
                        View incident
                      </Link>
                    ) : null}
                    {!item.readAt ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-charcoal/60"
                        onClick={() => void markRead(item.id)}
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </li>
              ))
            ) : (
              <li className="text-sm text-brand-charcoal/60">No notifications yet.</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
