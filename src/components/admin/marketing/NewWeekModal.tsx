"use client";

import { useState } from "react";
import { Card, PrimaryButton, SecondaryButton } from "./ui";

type NewWeekModalProps = {
  busy: boolean;
  initialWeekStart: string;
  onClose: () => void;
  onCreated: (planId: string) => void;
  setMessage: (message: string | null) => void;
};

export function NewWeekModal({
  busy,
  initialWeekStart,
  onClose,
  onCreated,
  setMessage,
}: NewWeekModalProps) {
  const [weekStart, setWeekStart] = useState(initialWeekStart);

  async function createWeek() {
    setMessage(null);
    const res = await fetch("/api/admin/marketing/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart }),
    });
    const json = (await res.json()) as { error?: string; plan?: { id: string } };
    if (!res.ok) {
      setMessage(json.error ?? "Could not create week.");
      return;
    }
    if (!json.plan?.id) {
      setMessage("Week was saved but the response was incomplete.");
      return;
    }
    onCreated(json.plan.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
      <Card className="w-full max-w-md">
        <h3 className="text-lg font-extrabold text-brand-navy">New Week</h3>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Creates an empty planning week. It won&apos;t generate or publish posts.
        </p>
        <label className="mt-4 block text-sm font-semibold text-brand-charcoal">
          Week starting
          <input
            type="date"
            className="mt-1 w-full rounded-xl border border-brand-brown/20 px-3 py-2 text-sm"
            value={weekStart}
            disabled={busy}
            onChange={(event) => setWeekStart(event.target.value)}
          />
        </label>
        <p className="mt-2 text-xs text-brand-charcoal/55">
          Dates are normalized to the Monday of that week (UTC).
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="button" disabled={busy} onClick={() => void createWeek()}>
            Create Week
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
