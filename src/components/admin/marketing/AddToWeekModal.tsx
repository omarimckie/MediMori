"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { contentBodyExcerpt } from "@/lib/marketing/content-client-utils";
import type { SmartUploadPairResolution } from "@/lib/marketing/content-assign-week";
import { formatWeekPlanSelectorLabel } from "@/lib/marketing/content-client-utils";
import { Card, PrimaryButton, SecondaryButton } from "./ui";

type WeeklyPlanOption = {
  id: string;
  weekStart: string;
};

type AddToWeekModalProps = {
  open: boolean;
  busy: boolean;
  anchorContentId: string;
  anchorTitle: string | null;
  anchorBody: string;
  previewUrl: string | null;
  plans: WeeklyPlanOption[];
  initialWeeklyPlanId: string | null;
  modalTitle?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (input: { weeklyPlanId: string; contentIds: string[] }) => void;
};

export function AddToWeekModal({
  open,
  busy,
  anchorContentId,
  anchorTitle,
  anchorBody,
  previewUrl,
  plans,
  initialWeeklyPlanId,
  modalTitle = "Add to Week",
  confirmLabel = "Add to Week",
  onClose,
  onConfirm,
}: AddToWeekModalProps) {
  const [weeklyPlanId, setWeeklyPlanId] = useState("");
  const [pair, setPair] = useState<SmartUploadPairResolution | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [includeInstagram, setIncludeInstagram] = useState(true);
  const [includeFacebook, setIncludeFacebook] = useState(true);

  useEffect(() => {
    if (!open) return;
    setWeeklyPlanId(initialWeeklyPlanId ?? "");
    setIncludeInstagram(true);
    setIncludeFacebook(true);
    setPair(null);
    setPairLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/marketing/content/smart-upload-pair?contentId=${encodeURIComponent(anchorContentId)}`,
        );
        if (res.ok) {
          const json = (await res.json()) as { pair: SmartUploadPairResolution };
          setPair(json.pair);
        }
      } finally {
        setPairLoading(false);
      }
    })();
  }, [open, anchorContentId, initialWeeklyPlanId, plans]);

  if (!open) return null;

  const completePair = pair?.kind === "complete" ? pair : null;
  const pairWarning =
    pair?.kind === "partial_or_inconsistent"
      ? pair.message
      : pair?.kind === "no_finalize_key" && pair
        ? null
        : null;

  function selectedContentIds(): string[] {
    if (completePair) {
      const ids: string[] = [];
      if (includeInstagram) ids.push(completePair.instagramId);
      if (includeFacebook) ids.push(completePair.facebookId);
      return ids;
    }
    return [anchorContentId];
  }

  const canSubmit =
    Boolean(weeklyPlanId) &&
    plans.length > 0 &&
    selectedContentIds().length > 0 &&
    !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h3 className="text-lg font-extrabold text-brand-navy">{modalTitle}</h3>
        {plans.length === 0 ? (
          <div className="mt-4 space-y-3 text-sm text-brand-charcoal/80">
            <p>No weekly plans are available yet. Create an empty week from Your Week, or generate a campaign package.</p>
            <Link href="/admin/marketing/week" className="font-bold text-brand-navy underline">
              New Week (Your Week)
            </Link>
            <span className="text-brand-charcoal/50"> · </span>
            <Link
              href="/admin/marketing/campaigns"
              className="font-bold text-brand-navy underline"
            >
              Campaigns
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-4 flex gap-3">
              {previewUrl ? (
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-brand-brown/15 bg-cream-deep">
                  <Image
                    src={previewUrl}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : null}
              <div className="min-w-0">
                <p className="text-sm font-bold text-brand-navy">{anchorTitle || "Untitled"}</p>
                <p className="mt-1 text-xs text-brand-charcoal/70">{contentBodyExcerpt(anchorBody, 140)}</p>
              </div>
            </div>

            <label className="mt-4 block text-sm font-bold">
              Week
              <select
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm"
                value={weeklyPlanId}
                onChange={(e) => setWeeklyPlanId(e.target.value)}
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {formatWeekPlanSelectorLabel(plan.weekStart)}
                  </option>
                ))}
              </select>
            </label>

            {pairLoading ? (
              <p className="mt-3 text-xs text-brand-charcoal/55">Checking Smart Upload pair…</p>
            ) : null}
            {completePair ? (
              <fieldset className="mt-4 space-y-2">
                <legend className="text-sm font-bold">Platforms</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeInstagram}
                    onChange={(e) => setIncludeInstagram(e.target.checked)}
                  />
                  Instagram
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeFacebook}
                    onChange={(e) => setIncludeFacebook(e.target.checked)}
                  />
                  Facebook
                </label>
                {!includeInstagram && !includeFacebook ? (
                  <p className="text-xs font-semibold text-brand-orange-deep">
                    Select at least one platform.
                  </p>
                ) : null}
              </fieldset>
            ) : null}
            {pairWarning ? (
              <p className="mt-3 text-xs text-brand-charcoal/60">{pairWarning}</p>
            ) : null}
          </>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>
            Cancel
          </SecondaryButton>
          {plans.length > 0 ? (
            <PrimaryButton
              type="button"
              disabled={!canSubmit}
              onClick={() =>
                onConfirm({
                  weeklyPlanId,
                  contentIds: selectedContentIds(),
                })
              }
            >
              {confirmLabel}
            </PrimaryButton>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
