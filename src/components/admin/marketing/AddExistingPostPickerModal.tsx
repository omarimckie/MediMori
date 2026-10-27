"use client";

import {
  calendarAddExistingEligibility,
  contentMatchesAddExistingSearch,
  type CalendarAddExistingMode,
} from "@/lib/marketing/calendar-add-existing-eligibility";
import { PLATFORM_LABELS } from "@/lib/marketing/config";
import type { MarketingContent, MarketingPublication } from "@/lib/marketing/types";
import { useMemo, useState } from "react";
import { SecondaryButton, StatusPill } from "./ui";

export type AddExistingPostPickerItem = Pick<
  MarketingContent,
  "id" | "title" | "body" | "platform" | "format" | "status" | "scheduledFor"
>;

type Props = {
  items: AddExistingPostPickerItem[];
  publications: Pick<
    MarketingPublication,
    "contentId" | "platform" | "status" | "publishedAt" | "externalId"
  >[];
  busy: boolean;
  onClose: () => void;
  onSelect: (item: AddExistingPostPickerItem, mode: CalendarAddExistingMode) => void;
};

function hasPublishedPublicationForContent(
  publications: Props["publications"],
  content: AddExistingPostPickerItem,
): boolean {
  return publications.some(
    (row) =>
      row.contentId === content.id &&
      row.platform === content.platform &&
      row.status === "published" &&
      Boolean(row.publishedAt ?? row.externalId),
  );
}

export function AddExistingPostPickerModal({
  items,
  publications,
  busy,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const ta = (a.title ?? a.body).toLowerCase();
      const tb = (b.title ?? b.body).toLowerCase();
      return ta.localeCompare(tb);
    });
    return sorted.filter((item) => contentMatchesAddExistingSearch(item, query));
  }, [items, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/40 p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-xl"
        role="dialog"
        aria-labelledby="add-existing-post-title"
      >
        <h2 id="add-existing-post-title" className="font-display text-2xl text-brand-navy">
          Add existing post
        </h2>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Choose a post from all marketing content. Published social posts are scheduled via
          recycle.
        </p>
        <label className="mt-4 block text-sm font-bold text-brand-charcoal">
          Search
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, body, or platform"
            className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
            autoFocus
          />
        </label>
        <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {filtered.map((item) => {
            const eligibility = calendarAddExistingEligibility({
              status: item.status,
              platform: item.platform,
              format: item.format,
              hasPublishedPublication: hasPublishedPublicationForContent(publications, item),
            });
            const label = item.title?.trim() || item.body.slice(0, 80);
            const platformLabel = PLATFORM_LABELS[item.platform] ?? item.platform;
            return (
              <li
                key={item.id}
                className="rounded-2xl border border-brand-brown/15 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-brand-navy">{label}</p>
                    <p className="text-xs text-brand-charcoal/60">{platformLabel}</p>
                    {eligibility.eligible ? (
                      <p className="mt-1 text-xs text-brand-green-deep">{eligibility.hint}</p>
                    ) : (
                      <p className="mt-1 text-xs text-brand-orange-deep">{eligibility.reason}</p>
                    )}
                  </div>
                  <StatusPill status={item.status} />
                </div>
                <div className="mt-2">
                  <SecondaryButton
                    type="button"
                    disabled={busy || !eligibility.eligible}
                    onClick={() => {
                      if (!eligibility.eligible) return;
                      onSelect(item, eligibility.mode);
                    }}
                  >
                    {eligibility.eligible && eligibility.mode === "recycle"
                      ? "Schedule recycle"
                      : "Schedule"}
                  </SecondaryButton>
                </div>
              </li>
            );
          })}
          {!filtered.length ? (
            <li className="text-sm text-brand-charcoal/70">No matching content.</li>
          ) : null}
        </ul>
        <div className="mt-4 flex justify-end">
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>
            Cancel
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}
