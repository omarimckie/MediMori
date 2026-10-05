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
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-brand-brown/15 bg-white p-3 shadow-xl">
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
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {items.length ? (
              items.slice(0, 8).map((item) => (
                <li
                  key={item.id}
                  className={`rounded-xl border p-2 text-sm ${
                    item.readAt ? "border-brand-brown/10" : "border-brand-gold/40 bg-brand-gold/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-brand-navy">{item.title}</p>
                    <span className="text-[10px] font-bold uppercase text-brand-charcoal/50">
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-brand-charcoal/75 line-clamp-2">{item.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={item.destination}
                      className="text-xs font-bold text-brand-green-deep"
                      onClick={() => void markRead(item.id)}
                    >
                      Open
                    </Link>
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
