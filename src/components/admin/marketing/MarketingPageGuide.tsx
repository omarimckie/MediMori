"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import {
  getMarketingPageGuide,
  type MarketingPageGuideId,
} from "@/lib/marketing/marketing-page-guides";

export function marketingPageGuideStorageKey(id: MarketingPageGuideId): string {
  return `marketing-page-guide:${id}`;
}
const guidePreferenceFallback = new Map<string, boolean>();
const guidePreferenceListeners = new Map<string, Set<() => void>>();

function readGuidePreference(id: MarketingPageGuideId): boolean {
  const key = marketingPageGuideStorageKey(id);
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? (guidePreferenceFallback.get(key) ?? false) : stored === "expanded";
  } catch {
    return guidePreferenceFallback.get(key) ?? false;
  }
}

function subscribeToGuidePreference(id: MarketingPageGuideId, listener: () => void) {
  const key = marketingPageGuideStorageKey(id);
  const listeners = guidePreferenceListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  guidePreferenceListeners.set(key, listeners);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    if (event.key === null || event.newValue === null) guidePreferenceFallback.delete(key);
    else guidePreferenceFallback.set(key, event.newValue === "expanded");
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners.delete(listener);
    if (listeners.size === 0) guidePreferenceListeners.delete(key);
  };
}

function writeGuidePreference(id: MarketingPageGuideId, expanded: boolean) {
  const key = marketingPageGuideStorageKey(id);
  guidePreferenceFallback.set(key, expanded);
  try {
    window.localStorage.setItem(key, expanded ? "expanded" : "collapsed");
  } catch {
    // Keep the preference usable for this page when browser storage is unavailable.
  }
  guidePreferenceListeners.get(key)?.forEach((listener) => listener());
}

type MarketingPageGuideProps = {
  id: MarketingPageGuideId;
  /** Test-only: skip localStorage and fix initial expand state. */
  initialExpanded?: boolean;
};

export function MarketingPageGuide({ id, initialExpanded }: MarketingPageGuideProps) {
  const guide = getMarketingPageGuide(id);
  const panelId = useId();
  const subscribe = useCallback(
    (listener: () => void) => initialExpanded === undefined ? subscribeToGuidePreference(id, listener) : () => {},
    [id, initialExpanded],
  );
  const getPreference = useCallback(() => initialExpanded === undefined ? readGuidePreference(id) : initialExpanded, [id, initialExpanded]);
  const getServerPreference = useCallback(() => initialExpanded ?? false, [initialExpanded]);
  const storedExpanded = useSyncExternalStore(subscribe, getPreference, getServerPreference);
  const [testExpanded, setTestExpanded] = useState(initialExpanded ?? false);
  const expanded = initialExpanded === undefined ? storedExpanded : testExpanded;

  function toggle() {
    const next = !expanded;
    if (initialExpanded !== undefined) {
      setTestExpanded(next);
      return;
    }
    writeGuidePreference(id, next);
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
