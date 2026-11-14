"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { formatWeekPlanSelectorLabel } from "@/lib/marketing/content-client-utils";
import { PrimaryButton, SecondaryButton } from "./ui";

type WeeklyPlanOption = { id: string; weekStart: string };

type AssignWeekModalProps = {
  open: boolean;
  busy: boolean;
  contentLabel: string;
  plans: WeeklyPlanOption[];
  initialWeeklyPlanId: string | null;
  onClose: () => void;
  onConfirm: (weeklyPlanId: string) => void;
};

export function AssignWeekModal({
  open,
  busy,
  contentLabel,
  plans,
  initialWeeklyPlanId,
  onClose,
  onConfirm,
}: AssignWeekModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [weeklyPlanId, setWeeklyPlanId] = useState(initialWeeklyPlanId ?? "");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const canSubmit = Boolean(weeklyPlanId) && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/40 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="font-display text-xl text-brand-navy">
          Assign week
        </h2>
        <p className="mt-2 text-sm text-brand-charcoal/75">{contentLabel}</p>

        {plans.length === 0 ? (
          <div className="mt-4 space-y-2 text-sm text-brand-charcoal/80">
            <p>No weekly plans exist yet. Create one from Your week — this does not block the planner queue.</p>
            <Link href="/admin/marketing/week" className="font-bold text-brand-navy underline">
              Open Your week
            </Link>
          </div>
        ) : (
          <label className="mt-4 block text-sm font-bold">
            Week (optional organization)
            <select
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
              value={weeklyPlanId}
              onChange={(e) => setWeeklyPlanId(e.target.value)}
            >
              <option value="">Select a week…</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {formatWeekPlanSelectorLabel(plan.weekStart)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            disabled={!canSubmit || plans.length === 0}
            onClick={() => onConfirm(weeklyPlanId)}
          >
            Save week
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
