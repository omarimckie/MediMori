"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

type Overview = {
  mockMode: boolean;
  currentCampaign: {
    id: string;
    name: string;
    objective: string;
    status: string;
    primaryAudience: string;
    coreMessage: string;
  } | null;
  readyPlan: {
    id: string;
    weekStart: string;
    status: string;
    summary: {
      itemCount: number;
      newAssetCount: number;
      warningCount: number;
      objective: string;
      audience: string;
    };
  } | null;
  counts: Record<string, number>;
  estimatedCostUsd: number;
  allowDemoSeed: boolean;
  recentContent: Array<{
    id: string;
    title: string | null;
    platform: string;
    status: string;
    category: string;
  }>;
};

export function OverviewClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const overview = await api<Overview>("/api/admin/marketing");
    setData(overview);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: Error) => setMessage(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function seed() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ seeded: boolean; note?: string; reason?: string }>(
        "/api/admin/marketing/seed",
        { method: "POST" },
      );
      setMessage(result.note || result.reason || "Seed complete.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Seed failed");
    }
    setBusy(false);
  }

  async function generateWeek() {
    if (!data?.currentCampaign) return;
    setBusy(true);
    try {
      await api(`/api/admin/marketing/campaigns/${data.currentCampaign.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "generate_week" }),
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate week");
    }
    setBusy(false);
  }

  if (!data) {
    return <p className="text-sm text-brand-charcoal/70">{message ?? "Loading overview…"}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-brand-charcoal/75">
          Mock mode is <strong>{data.mockMode ? "on" : "off"}</strong>. Live social/email/AI
          side effects stay off until MARKETING_MOCK_MODE=false.
        </p>
        <div className="flex flex-wrap gap-2">
          {data.allowDemoSeed ? (
            <SecondaryButton onClick={() => void seed()} disabled={busy}>
              Load demo seed
            </SecondaryButton>
          ) : null}
          <Link
            href="/admin/marketing/campaigns"
            className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal hover:bg-cream-deep"
          >
            Campaigns
          </Link>
          <PrimaryButton onClick={() => void generateWeek()} disabled={busy || !data.currentCampaign}>
            Generate this week
          </PrimaryButton>
        </div>
      </div>
      {message ? (
        <p className="rounded-2xl bg-brand-gold/20 px-4 py-3 text-sm font-semibold">{message}</p>
      ) : null}

      {data.readyPlan ? (
        <Card className="bg-brand-navy text-white">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-gold">Your week is ready</p>
          <h2 className="mt-2 font-display text-3xl">Week of {data.readyPlan.weekStart}</h2>
          <p className="mt-2 max-w-2xl text-sm text-white/80">{data.readyPlan.summary.objective}</p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase text-white/60">Items</dt>
              <dd className="text-2xl font-extrabold">{data.readyPlan.summary.itemCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-white/60">New assets needed</dt>
              <dd className="text-2xl font-extrabold">{data.readyPlan.summary.newAssetCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-white/60">Warnings</dt>
              <dd className="text-2xl font-extrabold">{data.readyPlan.summary.warningCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-white/60">Audience</dt>
              <dd className="text-lg font-bold">{data.readyPlan.summary.audience}</dd>
            </div>
          </dl>
          <Link
            href="/admin/marketing/week"
            className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand-gold px-4 text-sm font-bold text-brand-navy"
          >
            Review weekly package
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Awaiting approval", data.counts.needsReview],
          ["Scheduled", data.counts.scheduled],
          ["Published", data.counts.published],
          ["Est. ops cost", `$${data.estimatedCostUsd.toFixed(4)}`],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">{label}</p>
            <p className="mt-2 font-display text-3xl text-brand-navy">{value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">Current campaign</p>
        {data.currentCampaign ? (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-extrabold text-brand-charcoal">{data.currentCampaign.name}</h2>
              <StatusPill status={data.currentCampaign.status} />
            </div>
            <p className="mt-2 text-sm text-brand-charcoal/75">{data.currentCampaign.objective}</p>
            <p className="mt-2 text-sm">{data.currentCampaign.coreMessage}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm">No campaign yet. Create one under Campaigns.</p>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Recent content</h2>
          <Link href="/admin/marketing/content" className="text-sm font-bold text-brand-green-deep">
            Open queue
          </Link>
        </div>
        <ul className="mt-4 space-y-3">
          {data.recentContent.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-brown/10 pb-3">
              <div>
                <p className="font-bold">{item.title || "Untitled"}</p>
                <p className="text-xs text-brand-charcoal/60">
                  {item.platform} · {item.category.replaceAll("_", " ")}
                </p>
              </div>
              <StatusPill status={item.status} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
