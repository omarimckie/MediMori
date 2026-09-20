"use client";

import { useEffect, useState } from "react";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

type Rec = {
  id: string;
  title: string;
  recommendation: string;
  reason: string;
  evidenceStrength: string;
  status: string;
  supportingData: Record<string, unknown>;
};

export function RecommendationsClient() {
  const [items, setItems] = useState<Rec[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/marketing/recommendations").then((res) => res.json());
    setItems(data.recommendations ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function generate() {
    setBusy(true);
    await fetch("/api/admin/marketing/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate" }),
    });
    await load();
    setBusy(false);
  }

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

  return (
    <div className="space-y-4">
      <PrimaryButton onClick={() => void generate()} disabled={busy}>
        Generate recommendations
      </PrimaryButton>
      {items.map((item) => (
        <Card key={item.id}>
          <div className="flex flex-wrap gap-2">
            <StatusPill status={item.status} />
            <StatusPill status={item.evidenceStrength} />
          </div>
          <h3 className="mt-2 text-xl font-extrabold">{item.title}</h3>
          <p className="mt-2 text-sm">{item.recommendation}</p>
          <p className="mt-2 text-sm text-brand-charcoal/70">{item.reason}</p>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-cream-deep p-3 text-xs">
            {JSON.stringify(item.supportingData, null, 2)}
          </pre>
          {item.status === "open" ? (
            <div className="mt-3 flex flex-wrap gap-2">
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
          ) : null}
        </Card>
      ))}
    </div>
  );
}
