"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

type ContentItem = {
  id: string;
  campaignId: string | null;
  weeklyPlanId: string | null;
  platform: string;
  format: string;
  category: string;
  audience: string;
  status: string;
  title: string | null;
  body: string;
  cta: string | null;
  warnings: string[];
  needsNewAsset: boolean;
  scheduledFor: string | null;
  trackingToken: string | null;
  bookId: string | null;
};

type Settings = {
  plans: Array<{
    id: string;
    weekStart: string;
    status: string;
    campaignId: string | null;
    summary: {
      itemCount: number;
      newAssetCount: number;
      warningCount: number;
      objective: string;
      audience: string;
    };
  }>;
};

export function WeekClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const plan = settings?.plans[0];

  async function load() {
    const settingsData = (await fetch("/api/admin/marketing/settings").then((res) => res.json())) as Settings;
    setSettings(settingsData);
    const planId = settingsData.plans[0]?.id;
    const query = planId ? `?weeklyPlanId=${planId}` : "";
    const contentData = await fetch(`/api/admin/marketing/content${query}`).then((res) => res.json());
    setContent(contentData.content ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ContentItem[]>();
    for (const item of content) {
      const list = map.get(item.platform) ?? [];
      list.push(item);
      map.set(item.platform, list);
    }
    return map;
  }, [content]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "Action failed");
    await load();
    setBusy(false);
  }

  if (!settings) {
    return (
      <Card>
        <p>Loading this week’s package…</p>
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card>
        <p>No weekly plan yet. Create a campaign and generate a week first.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-brand-navy text-white">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-gold">Your week is ready</p>
        <h2 className="mt-2 font-display text-3xl">Week of {plan.weekStart}</h2>
        <p className="mt-2 text-white/80">{plan.summary.objective}</p>
        <p className="mt-3 text-sm">
          {plan.summary.itemCount} items · {plan.summary.newAssetCount} need new assets ·{" "}
          {plan.summary.warningCount} with warnings · audience: {plan.summary.audience}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("/api/admin/marketing/week", { action: "approve_all", weeklyPlanId: plan.id })}
            className="inline-flex h-10 items-center rounded-xl bg-brand-gold px-4 text-sm font-bold text-brand-navy"
          >
            Approve all
          </button>
          <SecondaryButton
            disabled={busy}
            onClick={() =>
              void act("/api/admin/marketing/week", {
                action: "reject_all",
                weeklyPlanId: plan.id,
                feedback: "Rejected from weekly package.",
              })
            }
          >
            Reject all
          </SecondaryButton>
          <SecondaryButton
            disabled={busy}
            onClick={() => void act("/api/cron/marketing-publish", {})}
          >
            Publish due items
          </SecondaryButton>
        </div>
      </Card>
      {message ? <p className="text-sm font-semibold text-brand-orange-deep">{message}</p> : null}

      {[...grouped.entries()].map(([platform, items]) => (
        <section key={platform} className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-brand-green-deep">{platform}</h3>
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    <StatusPill status={item.status} />
                    <StatusPill status={item.category} />
                    <StatusPill status={item.format} />
                    {item.needsNewAsset ? <StatusPill status="needs asset" /> : null}
                  </div>
                  <h4 className="mt-2 text-lg font-extrabold">{item.title}</h4>
                  <textarea
                    className="mt-3 w-full rounded-2xl border border-brand-brown/20 p-3 text-sm"
                    rows={6}
                    value={editing[item.id] ?? item.body}
                    onChange={(event) =>
                      setEditing((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  {item.warnings.length ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-brand-orange-deep">
                      {item.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.trackingToken ? (
                    <p className="mt-2 text-xs text-brand-charcoal/55">
                      Tracking link: /api/m/{item.trackingToken}
                    </p>
                  ) : null}
                </div>
                <div className="flex w-40 flex-col gap-2">
                  <PrimaryButton
                    disabled={busy}
                    onClick={() =>
                      void act(`/api/admin/marketing/content/${item.id}`, { action: "approve" })
                    }
                  >
                    Approve
                  </PrimaryButton>
                  <SecondaryButton
                    disabled={busy}
                    onClick={() =>
                      void act(`/api/admin/marketing/content/${item.id}`, {
                        action: "edit",
                        body: editing[item.id] ?? item.body,
                      })
                    }
                  >
                    Save edit
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={busy}
                    onClick={() =>
                      void act(`/api/admin/marketing/content/${item.id}`, { action: "regenerate" })
                    }
                  >
                    Regenerate
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={busy}
                    onClick={() =>
                      void act(`/api/admin/marketing/content/${item.id}`, {
                        action: "reject",
                        feedback: "Rejected from weekly review.",
                      })
                    }
                  >
                    Reject
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={busy || item.status !== "approved"}
                    onClick={() =>
                      void act(`/api/admin/marketing/content/${item.id}`, { action: "schedule" })
                    }
                  >
                    Schedule
                  </SecondaryButton>
                </div>
              </div>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
