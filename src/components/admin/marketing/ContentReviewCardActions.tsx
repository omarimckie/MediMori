"use client";

import { shouldShowRecycleOnReviewCard } from "@/lib/marketing/recycle-eligibility";
import type { MarketingContent } from "@/lib/marketing/types";
import { PrimaryButton, SecondaryButton } from "./ui";

export type ContentReviewCardItem = {
  id: string;
  status: string;
  platform: string;
  format: string;
  body: string;
  title: string | null;
  scheduledFor: string | null;
  weeklyPlanId: string | null;
};

type Props = {
  item: ContentReviewCardItem;
  busy: boolean;
  hasPublishedPublication: boolean;
  onApprove: () => void;
  onSaveEdit: () => void;
  onRegenerate: () => void;
  onReject: () => void;
  onSchedule: () => void;
  onRecycle: () => void;
};

export function reviewScheduleModalState(
  scheduleItem: ContentReviewCardItem | null,
  recycleItem: ContentReviewCardItem | null,
): { mode: "schedule" | "recycle"; item: ContentReviewCardItem } | null {
  if (recycleItem) return { mode: "recycle", item: recycleItem };
  if (scheduleItem) return { mode: "schedule", item: scheduleItem };
  return null;
}

export function ContentReviewCardActions({
  item,
  busy,
  hasPublishedPublication,
  onApprove,
  onSaveEdit,
  onRegenerate,
  onReject,
  onSchedule,
  onRecycle,
}: Props) {
  const platform = item.platform as MarketingContent["platform"];
  const format = item.format as MarketingContent["format"];
  const showRecycle = shouldShowRecycleOnReviewCard({
    status: item.status,
    platform,
    format,
    hasPublishedPublication,
  });
  const scheduleDisabled =
    busy ||
    hasPublishedPublication ||
    (item.status !== "approved" && item.status !== "scheduled");

  return (
    <div className="flex w-40 flex-col gap-2">
      <PrimaryButton disabled={busy} onClick={onApprove}>
        Approve
      </PrimaryButton>
      <SecondaryButton disabled={busy} onClick={onSaveEdit}>
        Save edit
      </SecondaryButton>
      <SecondaryButton disabled={busy} onClick={onRegenerate}>
        Regenerate
      </SecondaryButton>
      <SecondaryButton disabled={busy} onClick={onReject}>
        Reject
      </SecondaryButton>
      <SecondaryButton disabled={scheduleDisabled} onClick={onSchedule}>
        Schedule
      </SecondaryButton>
      {showRecycle ? (
        <SecondaryButton
          type="button"
          data-action="recycle"
          disabled={busy}
          onClick={onRecycle}
        >
          Recycle
        </SecondaryButton>
      ) : null}
    </div>
  );
}
