"use client";

import { useEffect, useState } from "react";
import { Card, PrimaryButton, SecondaryButton } from "./ui";

type Report = {
  generatedAt: string;
  contentPublished: number;
  byPlatform: Record<string, number>;
  totals: Record<string, number>;
  trackingClicks: number;
  purchases: Record<string, number>;
  topPerforming: Array<{ title: string; platform: string; engagements: number }>;
  underperforming: Array<{ title: string; platform: string; engagements: number }>;
  estimatedCostUsd: number;
  recommendations: Array<{
    id: string;
    title: string;
    recommendation: string;
    reason: string;
    evidenceStrength: string;
    status: string;
  }>;
  notes: string[];
};

export function ReportClient() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/marketing/report").then((res) => res.json());
    setReport(data.report);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function decide(id: string, status: "accepted" | "rejected" | "dismissed") {
    setBusy(true);
    await fetch("/api/admin/marketing/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decide", id, status }),
    });
    await load();
    setBusy(false);
  }

  if (!report) return <p>Building weekly report…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-bold uppercase text-brand-green-deep">Weekly marketing report</p>
        <p className="mt-2 text-sm text-brand-charcoal/60">Generated {new Date(report.generatedAt).toLocaleString()}</p>
        <p className="mt-3 text-lg font-extrabold">{report.contentPublished} published items</p>
        <p className="text-sm">Estimated operations cost: ${report.estimatedCostUsd.toFixed(4)}</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-extrabold">Engagement & traffic</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(report.totals).map(([key, value]) => (
              <li key={key}>
                {key}: <strong>{value}</strong>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="font-extrabold">Purchases (existing table)</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(report.purchases).map(([key, value]) => (
              <li key={key}>
                {key}: <strong>{value}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <h3 className="font-extrabold">Top performing</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {report.topPerforming.map((item) => (
            <li key={item.title}>
              {item.title} · {item.platform} · {item.engagements} engagements
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Underperforming</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {report.underperforming.map((item) => (
            <li key={item.title}>
              {item.title} · {item.platform} · {item.engagements} engagements
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-extrabold">Recommendations</h3>
        <p className="mt-1 text-xs text-brand-charcoal/60">Suggestions only — strategy is not auto-changed.</p>
        <ul className="mt-3 space-y-3">
          {report.recommendations.map((item) => (
            <li key={item.id}>
              <p className="font-bold">{item.title}</p>
              <p className="text-sm">{item.recommendation}</p>
              <p className="mt-1 text-xs text-brand-charcoal/60">{item.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PrimaryButton disabled={busy} onClick={() => void decide(item.id, "accepted")}>
                  Accept
                </PrimaryButton>
                <SecondaryButton disabled={busy} onClick={() => void decide(item.id, "rejected")}>
                  Reject
                </SecondaryButton>
                <SecondaryButton disabled={busy} onClick={() => void decide(item.id, "dismissed")}>
                  Dismiss
                </SecondaryButton>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <ul className="list-disc pl-5 text-xs text-brand-charcoal/60">
        {report.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
