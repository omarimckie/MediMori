"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  contentBodyExcerpt,
  formatContentCreatedAt,
  formatContentWeekLabel,
} from "@/lib/marketing/content-client-utils";
import { AddToWeekModal } from "./AddToWeekModal";
import { Card, SecondaryButton, StatusPill } from "./ui";

type ContentItem = {
  id: string;
  platform: string;
  category: string;
  audience: string;
  status: string;
  title: string | null;
  body: string;
  cta: string | null;
  weeklyPlanId: string | null;
  createdAt: string;
};

type WeeklyPlanOption = {
  id: string;
  weekStart: string;
};

type PreviewById = Record<string, { previewUrl: string | null; showVisualPreview: boolean }>;

export function ContentClient() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [previewByContentId, setPreviewByContentId] = useState<PreviewById>({});
  const [plans, setPlans] = useState<WeeklyPlanOption[]>([]);
  const [currentWeekPlanId, setCurrentWeekPlanId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "",
    platform: "",
    category: "",
    audience: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [weekModal, setWeekModal] = useState<ContentItem | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set("enrich", "preview");
    const [contentRes, settingsRes] = await Promise.all([
      fetch(`/api/admin/marketing/content?${params}`),
      fetch("/api/admin/marketing/settings"),
    ]);
    const data = (await contentRes.json()) as {
      content?: ContentItem[];
      previewByContentId?: PreviewById;
    };
    setItems(data.content ?? []);
    setPreviewByContentId(data.previewByContentId ?? {});
    if (settingsRes.ok) {
      const settings = (await settingsRes.json()) as { plans?: WeeklyPlanOption[] };
      const planList = settings.plans ?? [];
      setPlans(planList);
      setCurrentWeekPlanId(planList[0]?.id ?? null);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function confirmAssignWeek(input: { weeklyPlanId: string; contentIds: string[] }) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/marketing/content/assign-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(json.error ?? "Could not assign to week.");
        return;
      }
      setWeekModal(null);
      setMessage("Assigned to week.");
      await load();
    } catch {
      setMessage("Network error while assigning to week.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-brand-charcoal/70">
          Marketing content inventory. Assign items to a weekly plan to include them on{" "}
          <Link href="/admin/marketing/week" className="font-bold text-brand-navy underline">
            Your week
          </Link>{" "}
          when that plan is active.
        </p>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["status", ["", "draft", "needs_review", "approved", "rejected", "scheduled", "published", "failed"]],
            ["platform", ["", "instagram", "facebook", "pinterest", "email", "website", "google"]],
            ["category", ["", "educational", "brand_story", "product_feature", "engagement", "trust", "conversion", "community"]],
            ["audience", ["", "parents", "hospitals", "schools", "libraries"]],
          ].map(([name, options]) => (
            <label key={String(name)} className="text-xs font-bold uppercase text-brand-charcoal/60">
              {String(name)}
              <select
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm font-semibold text-brand-charcoal"
                value={filters[name as keyof typeof filters]}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, [name as string]: event.target.value }))
                }
              >
                {(options as string[]).map((option) => (
                  <option key={option} value={option}>
                    {option || "all"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Card>

      {message ? (
        <p className="text-sm font-semibold text-brand-orange-deep" role="status">{message}</p>
      ) : null}

      {items.map((item) => {
        const preview = previewByContentId[item.id];
        const previewUrl = preview?.previewUrl ?? null;
        const week = formatContentWeekLabel(item.weeklyPlanId, plans);
        const onCurrentWeek =
          item.weeklyPlanId && currentWeekPlanId && item.weeklyPlanId === currentWeekPlanId;

        return (
          <Card key={item.id}>
            <div className="flex flex-col gap-4 sm:flex-row">
              {previewUrl ? (
                <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-2xl border border-brand-brown/15 bg-cream-deep sm:h-28 sm:w-28">
                  <Image
                    src={previewUrl}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div
                  className="flex h-28 w-full shrink-0 items-center justify-center rounded-2xl border border-dashed border-brand-brown/20 bg-cream-deep/50 text-xs text-brand-charcoal/45 sm:w-28"
                  aria-hidden
                >
                  No preview
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={item.status} />
                  <StatusPill status={item.platform} />
                  <StatusPill status={item.category} />
                  <StatusPill status={item.audience} />
                </div>
                <h3 className="mt-2 text-lg font-extrabold">{item.title || "Untitled"}</h3>
                <p className="mt-2 text-sm text-brand-charcoal/80">{contentBodyExcerpt(item.body)}</p>
                {item.cta?.trim() ? (
                  <p className="mt-2 text-xs font-semibold text-brand-navy">CTA: {item.cta.trim()}</p>
                ) : null}
                <p className="mt-2 text-xs text-brand-charcoal/55">
                  Created {formatContentCreatedAt(item.createdAt)}
                </p>
                <p className="mt-1 text-xs text-brand-charcoal/55">
                  Week: <span className="font-semibold">{week.label}</span>
                  {item.weeklyPlanId && !onCurrentWeek ? (
                    <span className="text-brand-charcoal/45">
                      {" "}
                      (not the plan shown on Your week — switch or generate that week to review here)
                    </span>
                  ) : null}
                  {onCurrentWeek ? (
                    <span className="text-brand-charcoal/45"> · visible on Your week now</span>
                  ) : null}
                </p>
                <div className="mt-3">
                  <SecondaryButton
                    type="button"
                    disabled={busy || plans.length === 0}
                    onClick={() => setWeekModal(item)}
                  >
                    {item.weeklyPlanId ? "Change Week" : "Add to Week"}
                  </SecondaryButton>
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      {!items.length ? (
        <p className="text-sm text-brand-charcoal/60">No content matches these filters.</p>
      ) : null}

      <SecondaryButton onClick={() => void load()}>Refresh</SecondaryButton>

      {weekModal ? (
        <AddToWeekModal
          open
          busy={busy}
          anchorContentId={weekModal.id}
          anchorTitle={weekModal.title}
          anchorBody={weekModal.body}
          previewUrl={previewByContentId[weekModal.id]?.previewUrl ?? null}
          plans={plans}
          initialWeeklyPlanId={weekModal.weeklyPlanId}
          onClose={() => setWeekModal(null)}
          modalTitle={weekModal.weeklyPlanId ? "Change Week" : "Add to Week"}
          confirmLabel={weekModal.weeklyPlanId ? "Save week" : "Add to Week"}
          onConfirm={(input) => void confirmAssignWeek(input)}
        />
      ) : null}
    </div>
  );
}
