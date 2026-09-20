"use client";

import { useEffect, useState } from "react";
import { Card, PrimaryButton, StatusPill } from "./ui";

type Analytics = {
  metrics: Array<{
    id: string;
    platform: string | null;
    impressions: number;
    engagements: number;
    clicks: number;
    emailOpens: number;
    websiteSessions: number;
    bookPageViews: number;
    source: string;
    metricDate: string;
  }>;
  clicks: Array<{ id: string; bookId: string | null; destinationPath: string; clickedAt: string }>;
  attribution: Array<{
    purchaseId: string;
    bookId: string;
    kind: string;
    reason: string;
  }>;
};

export function AnalyticsClient() {
  const [data, setData] = useState<Analytics | null>(null);
  const [publishing, setPublishing] = useState(false);

  async function load() {
    setData(await fetch("/api/admin/marketing/analytics").then((res) => res.json()));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function publishDue() {
    setPublishing(true);
    await fetch("/api/cron/marketing-publish", { method: "POST" });
    await load();
    setPublishing(false);
  }

  if (!data) return <p>Loading analytics…</p>;

  const totals = data.metrics.reduce(
    (acc, item) => {
      acc.impressions += item.impressions;
      acc.engagements += item.engagements;
      acc.clicks += item.clicks;
      acc.sessions += item.websiteSessions;
      acc.bookViews += item.bookPageViews;
      acc.emailOpens += item.emailOpens;
      return acc;
    },
    { impressions: 0, engagements: 0, clicks: 0, sessions: 0, bookViews: 0, emailOpens: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PrimaryButton onClick={() => void publishDue()} disabled={publishing}>
          Publish due items (mock-safe)
        </PrimaryButton>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Object.entries(totals).map(([label, value]) => (
          <Card key={label}>
            <p className="text-xs font-bold uppercase text-brand-green-deep">{label}</p>
            <p className="mt-2 font-display text-3xl text-brand-navy">{value}</p>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="text-lg font-extrabold">Purchase attribution</h2>
        <p className="mt-1 text-sm text-brand-charcoal/70">
          Uses the existing purchases table. No emails or payment details are shown.
        </p>
        <ul className="mt-4 space-y-3">
          {data.attribution.slice(0, 12).map((row) => (
            <li key={row.purchaseId} className="border-b border-brand-brown/10 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={row.kind} />
                <span className="text-sm font-bold">{row.bookId}</span>
              </div>
              <p className="mt-1 text-xs text-brand-charcoal/70">{row.reason}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-lg font-extrabold">Tracked clicks</h2>
        <p className="mt-2 text-sm">{data.clicks.length} click(s) recorded through marketing links.</p>
      </Card>
    </div>
  );
}
