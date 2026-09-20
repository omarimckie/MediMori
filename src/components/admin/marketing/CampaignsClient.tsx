"use client";

import { useEffect, useState } from "react";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

type Campaign = {
  id: string;
  name: string;
  objective: string;
  status: string;
  primaryAudience: string;
  secondaryAudience: string | null;
  coreMessage: string;
  bookIds: string[];
  cta: string | null;
  isDemo: boolean;
};

export function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [objective, setObjective] = useState("Promote the Sickle Cell book for 30 days.");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/marketing/campaigns").then((res) => res.json());
    setCampaigns(data.campaigns ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function createCampaign() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/marketing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective }),
    });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "Could not create campaign.");
    else setMessage(`Created ${data.campaign.name}`);
    await load();
    setBusy(false);
  }

  async function generateWeek(id: string) {
    setBusy(true);
    await fetch(`/api/admin/marketing/campaigns/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate_week" }),
    });
    setMessage("Weekly plan generated. Open Your week to review.");
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-extrabold">Create a campaign</h2>
        <p className="mt-1 text-sm text-brand-charcoal/70">
          Describe the objective. The planner uses catalog books, approved claims, and
          configurable channel quotas — it does not invent medical facts.
        </p>
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          className="mt-4 w-full rounded-2xl border border-brand-brown/20 p-3 text-sm"
          rows={3}
        />
        <div className="mt-3">
          <PrimaryButton onClick={() => void createCampaign()} disabled={busy}>
            Create campaign
          </PrimaryButton>
        </div>
        {message ? <p className="mt-3 text-sm font-semibold">{message}</p> : null}
      </Card>

      {["active", "planned", "completed", "archived"].map((status) => {
        const items = campaigns.filter((item) => item.status === status);
        if (!items.length && status !== "active") return null;
        return (
          <section key={status} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-green-deep">
              {status} campaigns
            </h2>
            {items.length ? (
              items.map((campaign) => (
                <Card key={campaign.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-extrabold">{campaign.name}</h3>
                        <StatusPill status={campaign.status} />
                        {campaign.isDemo ? <StatusPill status="demo" /> : null}
                      </div>
                      <p className="mt-2 text-sm">{campaign.objective}</p>
                      <p className="mt-2 text-sm text-brand-charcoal/70">{campaign.coreMessage}</p>
                      <p className="mt-2 text-xs text-brand-charcoal/55">
                        {campaign.primaryAudience}
                        {campaign.secondaryAudience ? ` · ${campaign.secondaryAudience}` : ""}
                        {" · "}
                        books: {campaign.bookIds.join(", ")}
                      </p>
                    </div>
                    <SecondaryButton onClick={() => void generateWeek(campaign.id)} disabled={busy}>
                      Generate week
                    </SecondaryButton>
                  </div>
                </Card>
              ))
            ) : (
              <p className="text-sm text-brand-charcoal/60">None yet.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
