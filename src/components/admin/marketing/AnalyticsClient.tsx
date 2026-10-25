"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketingAnalyticsDashboard } from "@/lib/marketing/analytics/analytics-aggregation";
import type { AnalyticsReportingWindow } from "@/lib/marketing/analytics/analytics-time";
import { publishDueButtonLabel } from "@/lib/marketing/publication-display";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

type WindowOption = AnalyticsReportingWindow;

function sourceLabel(source: string): string {
  if (source === "measured") return "Measured";
  if (source === "synthetic_mock") return "Mock (not live)";
  if (source === "unavailable") return "Not available";
  return source;
}

export function AnalyticsClient() {
  const [reportingWindow, setReportingWindow] = useState<WindowOption>("week");
  const [dashboard, setDashboard] = useState<MarketingAnalyticsDashboard | null>(null);
  const [mockMode, setMockMode] = useState(true);
  const [pinterestLiveConfigured, setPinterestLiveConfigured] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const params = new URLSearchParams({ window: reportingWindow });
      const [analyticsRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/marketing/analytics?${params}`),
        fetch("/api/admin/marketing/settings"),
      ]);
      if (!analyticsRes.ok) {
        setLoadError(`Analytics API returned ${analyticsRes.status}`);
        return;
      }
      const analytics = (await analyticsRes.json()) as MarketingAnalyticsDashboard;
      const settings = await settingsRes.json();
      setDashboard(analytics);
      setMockMode(settings.mockMode !== false);
      setPinterestLiveConfigured(settings.pinterestLiveConfigured === true);
    } catch {
      setLoadError("Could not load analytics.");
    }
  }, [reportingWindow]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void load();
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [load]);

  async function publishDue() {
    setPublishing(true);
    await fetch("/api/cron/marketing-publish", { method: "POST" });
    await load();
    setPublishing(false);
  }

  if (loadError) {
    return <p className="text-sm font-semibold text-brand-orange-deep" role="alert">{loadError}</p>;
  }
  if (!dashboard) return <p>Loading analytics…</p>;

  const measuredCards = [
    { label: "Tracked link clicks", value: dashboard.measured.trackedLinkClicks },
    { label: "Posts published", value: dashboard.measured.postsPublished },
    { label: "Resource downloads", value: dashboard.measured.resourceDownloads },
    { label: "Purchases (period)", value: dashboard.conversions.purchasesInPeriod },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["day", "week", "month"] as WindowOption[]).map((option) => (
            <SecondaryButton
              key={option}
              type="button"
              disabled={reportingWindow === option}
              onClick={() => setReportingWindow(option)}
            >
              {option === "day" ? "Daily" : option === "week" ? "Weekly" : "Monthly"}
            </SecondaryButton>
          ))}
        </div>
        <PrimaryButton onClick={() => void publishDue()} disabled={publishing}>
          {publishDueButtonLabel(mockMode, pinterestLiveConfigured)}
        </PrimaryButton>
      </div>

      <Card>
        <p className="text-xs font-bold uppercase text-brand-green-deep">Reporting period</p>
        <p className="mt-1 text-sm font-semibold text-brand-navy">{dashboard.period.label}</p>
        <p className="mt-1 text-xs text-brand-charcoal/60">
          Timezone: {dashboard.timezone} · Generated {new Date(dashboard.generatedAt).toLocaleString()}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-brand-charcoal/65">
          <span>Data freshness:</span>
          <span>clicks {dashboard.freshness.latestClickAt ?? "—"}</span>
          <span>· events {dashboard.freshness.latestEventAt ?? "—"}</span>
          <span>· metrics {dashboard.freshness.latestMetricAt ?? "—"}</span>
        </div>
      </Card>

      {dashboard.partialDataWarnings.length ? (
        <Card>
          <h2 className="text-sm font-extrabold text-brand-orange-deep">Partial or estimated data</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-brand-charcoal/75">
            {dashboard.partialDataWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold">Connections</h2>
        <ul className="mt-3 space-y-2">
          {dashboard.connections.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start gap-2 text-sm">
              <StatusPill status={row.status} />
              <span className="font-semibold">{row.label}</span>
              <span className="text-brand-charcoal/65">{row.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {measuredCards.map((card) => (
          <Card key={card.label}>
            <p className="text-xs font-bold uppercase text-brand-green-deep">{card.label}</p>
            <p className="mt-2 font-display text-3xl text-brand-navy">{card.value}</p>
            <p className="mt-1 text-xs text-brand-charcoal/55">Measured in this period</p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-lg font-extrabold">Platform attribution (tracked links)</h2>
        <p className="mt-1 text-xs text-brand-charcoal/65">
          Aligns with PR #7 UTM contract: utm_source = platform, utm_campaign = campaign id, utm_content =
          content id.
        </p>
        <ul className="mt-3 space-y-2">
          {dashboard.platformAttribution.length ? (
            dashboard.platformAttribution.map((row) => (
              <li key={row.platform} className="flex justify-between text-sm">
                <span className="font-semibold">{row.platform}</span>
                <span>
                  {row.trackedClicks} click(s) · {row.postsPublished} published
                </span>
              </li>
            ))
          ) : (
            <li className="text-sm text-brand-charcoal/60">No tracked clicks in this period.</li>
          )}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Visited pages (from tracked clicks)</h2>
        <p className="mt-1 text-xs text-brand-charcoal/65">
          Not full-site analytics — only destinations recorded on marketing link clicks.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {dashboard.visitedPages.slice(0, 12).map((row) => (
            <li key={row.destinationPath} className="flex justify-between gap-2">
              <code className="text-xs">{row.destinationPath}</code>
              <span>{row.trackedClicks}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Post performance</h2>
        <ul className="mt-3 space-y-3">
          {dashboard.postPerformance.slice(0, 15).map((row) => (
            <li key={row.contentId} className="border-b border-brand-brown/10 pb-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{row.title}</span>
                <StatusPill status={row.platform} />
              </div>
              <p className="mt-1 text-xs text-brand-charcoal/65">
                {row.trackedClicks} tracked click(s) · {row.status}
                {row.publishedInPeriod ? " · published in period" : ""}
              </p>
              <p className="text-xs text-brand-charcoal/55">
                Platform engagement:{" "}
                {row.engagementSource === "measured"
                  ? `${row.platformEngagements ?? 0} engagements / ${row.platformImpressions ?? 0} impressions`
                  : `${sourceLabel(row.engagementSource)}`}
              </p>
            </li>
          ))}
          {!dashboard.postPerformance.length ? (
            <li className="text-sm text-brand-charcoal/60">No posts with clicks or publications in period.</li>
          ) : null}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Social engagement (Facebook / Instagram / Pinterest)</h2>
        <p className="mt-1 text-xs text-brand-charcoal/65">
          Shown only when platform-sourced metrics exist. Mock metrics are excluded from these cards.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["facebook", "instagram", "pinterest"] as const).map((network) => {
            const row = dashboard.socialEngagement[network];
            return (
              <div key={network} className="rounded-xl border border-brand-brown/15 p-3 text-sm">
                <p className="font-bold capitalize">{network}</p>
                <p className="mt-1 text-xs">{sourceLabel(row.source)}</p>
                {row.source === "measured" ? (
                  <p className="mt-2">
                    {row.impressions ?? 0} impressions · {row.engagements ?? 0} engagements
                  </p>
                ) : (
                  <p className="mt-2 text-brand-charcoal/55">Not connected</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {dashboard.syntheticMetricsRollup.included ? (
        <Card>
          <h2 className="text-lg font-extrabold text-brand-orange-deep">Mock metrics (do not treat as live)</h2>
          <p className="mt-1 text-sm text-brand-charcoal/70">{dashboard.syntheticMetricsRollup.note}</p>
          <p className="mt-2 text-sm">
            {dashboard.syntheticMetricsRollup.impressions} impressions ·{" "}
            {dashboard.syntheticMetricsRollup.engagements} engagements ·{" "}
            {dashboard.syntheticMetricsRollup.clicks} clicks
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold">Purchase attribution (sample)</h2>
        <p className="mt-1 text-sm text-brand-charcoal/70">{dashboard.privacyNote}</p>
        <ul className="mt-4 space-y-3">
          {dashboard.attributionSample.slice(0, 10).map((row, index) => (
            <li key={`${row.bookId}-${row.kind}-${index}`} className="border-b border-brand-brown/10 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={row.kind} />
                <span className="text-sm font-bold">{row.bookId}</span>
              </div>
              <p className="mt-1 text-xs text-brand-charcoal/70">{row.reason}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
