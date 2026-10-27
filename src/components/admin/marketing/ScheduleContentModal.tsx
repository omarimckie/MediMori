"use client";

import {
  defaultFirstScheduleDatetimeLocal,
  defaultRecycleScheduleDatetimeLocal,
} from "@/lib/marketing/marketing-scheduling";
import { PrimaryButton, SecondaryButton } from "./ui";

type Props = {
  title: string | null;
  platform: string;
  marketingTimezone: string;
  initialScheduledFor: string | null;
  /** Plan week_start (YYYY-MM-DD) when content is assigned to a weekly plan; used for first-time defaults only. */
  assignedWeekStart?: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (marketingDatetimeLocal: string) => void;
  mode?: "schedule" | "recycle";
};

export function ScheduleContentModal({
  title,
  platform,
  marketingTimezone,
  initialScheduledFor,
  assignedWeekStart = null,
  busy,
  onClose,
  onConfirm,
  mode = "schedule",
}: Props) {
  const isRecycle = mode === "recycle";
  const defaultLocal = isRecycle
    ? defaultRecycleScheduleDatetimeLocal(
        initialScheduledFor,
        new Date(),
        marketingTimezone,
      )
    : defaultFirstScheduleDatetimeLocal({
        initialScheduledFor,
        assignedWeekStart,
        now: new Date(),
        timeZone: marketingTimezone,
      });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/40 p-4">
      <div
        className="w-full max-w-md rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-xl"
        role="dialog"
        aria-labelledby="schedule-content-title"
      >
        <h2 id="schedule-content-title" className="font-display text-2xl text-brand-navy">
          {isRecycle ? "Schedule recycled post" : "Schedule publish"}
        </h2>
        {isRecycle ? (
          <p className="mt-2 text-sm text-brand-charcoal/75">
            Choose when this post should be published again.
          </p>
        ) : null}
        <p className={`text-sm text-brand-charcoal/75 ${isRecycle ? "mt-1" : "mt-2"}`}>
          {title || platform}
        </p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
          Marketing timezone: {marketingTimezone}
        </p>
        {!isRecycle ? (
          <p className="mt-1 text-xs text-brand-charcoal/55">
            Adjust the date and time below before confirming — nothing is scheduled until you confirm.
          </p>
        ) : null}
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const value = String(data.get("scheduledFor") ?? "").trim();
            onConfirm(value);
          }}
        >
          <label className="block text-sm font-bold text-brand-charcoal">
            Date and time
            <input
              name="scheduledFor"
              type="datetime-local"
              required
              defaultValue={defaultLocal}
              className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
            />
          </label>
          <p className="text-xs text-brand-charcoal/60">
            Times are interpreted in {marketingTimezone}, not your browser&apos;s local timezone.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <SecondaryButton type="button" disabled={busy} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={busy}>
              {isRecycle ? "Confirm recycle" : "Confirm schedule"}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}
