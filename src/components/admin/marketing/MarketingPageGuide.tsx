"use client";

import { useEffect, useId, useState } from "react";
import {
  getMarketingPageGuide,
  type MarketingPageGuideId,
} from "@/lib/marketing/marketing-page-guides";

export function marketingPageGuideStorageKey(id: MarketingPageGuideId): string {
  return `marketing-page-guide:${id}`;
}

type MarketingPageGuideProps = {
  id: MarketingPageGuideId;
  /** Test-only: skip localStorage and fix initial expand state. */
  initialExpanded?: boolean;
};

export function MarketingPageGuide({ id, initialExpanded }: MarketingPageGuideProps) {
  const guide = getMarketingPageGuide(id);
  const panelId = useId();
  const [expanded, setExpanded] = useState(initialExpanded ?? false);

  useEffect(() => {
    if (initialExpanded !== undefined) return;
    try {
      const stored = window.localStorage.getItem(marketingPageGuideStorageKey(id));
      if (stored === "expanded") setExpanded(true);
    } catch {
      // ignore unavailable storage
    }
  }, [id, initialExpanded]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (initialExpanded !== undefined) return;
    try {
      window.localStorage.setItem(
        marketingPageGuideStorageKey(id),
        next ? "expanded" : "collapsed",
      );
    } catch {
      // ignore
    }
  }

  return (
    <section
      className="mb-4 rounded-2xl border border-brand-brown/15 bg-white/90 shadow-sm"
      aria-label={`About ${guide.title}`}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="text-sm font-bold text-brand-navy">About this page</span>
        <span className="text-xs font-semibold text-brand-green-deep" aria-hidden="true">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded ? (
        <div
          id={panelId}
          className="space-y-4 border-t border-brand-brown/10 px-4 pb-4 pt-3 text-sm text-brand-charcoal/85 sm:px-5"
        >
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              About this page
            </h2>
            <p className="mt-1 leading-relaxed">{guide.purpose}</p>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              What you should do here
            </h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 leading-relaxed">
              {guide.actions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              Good to know
            </h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 leading-relaxed">
              {guide.notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
