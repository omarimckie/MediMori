"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, SecondaryButton, StatusPill } from "./ui";

type ContentItem = {
  id: string;
  platform: string;
  category: string;
  audience: string;
  status: string;
  title: string | null;
  body: string;
  campaignId: string | null;
};

export function ContentClient() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [filters, setFilters] = useState({
    status: "",
    platform: "",
    category: "",
    audience: "",
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const data = await fetch(`/api/admin/marketing/content?${params}`).then((res) => res.json());
    setItems(data.content ?? []);
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-4">
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
      {items.map((item) => (
        <Card key={item.id}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} />
            <StatusPill status={item.platform} />
            <StatusPill status={item.category} />
            <StatusPill status={item.audience} />
          </div>
          <h3 className="mt-2 text-lg font-extrabold">{item.title || "Untitled"}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-brand-charcoal/80">{item.body}</p>
        </Card>
      ))}
      {!items.length ? <p className="text-sm text-brand-charcoal/60">No content matches these filters.</p> : null}
      <SecondaryButton onClick={() => void load()}>Refresh</SecondaryButton>
    </div>
  );
}
