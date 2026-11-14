"use client";

import Link from "next/link";
import { useState } from "react";
import {
  contentDisplayTitle,
  formatContentCreatedAt,
  formatContentWeekLabel,
} from "@/lib/marketing/content-client-utils";
import {
  contentCanEnqueueToPlanner,
  contentShowsInPlanner,
} from "@/lib/marketing/content-planner-client";
import {
  contentQueueRejectConfirmMessage,
  contentQueueShowsApproveReject,
  resolveReviewCardImageSrc,
  reviewCardPreviewUnavailableMessage,
} from "@/lib/marketing/content-queue-review";
import type { MarketingWebsiteDestinationReview } from "@/lib/marketing/marketing-website-destination";
import { ReviewPreviewImage } from "./ReviewPreviewImage";
import { WebsiteDestinationReview } from "./WebsiteDestinationReview";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

export type ContentQueueReviewItem = {
  id: string;
  platform: string;
  category: string;
  audience: string;
  status: string;
  title: string | null;
  body: string;
  cta: string | null;
  weeklyPlanId: string | null;
  plannerQueued?: boolean;
  createdAt: string;
};

type PlanOption = { id: string; weekStart: string };

type Props = {
  item: ContentQueueReviewItem;
  previewUrl: string | null;
  showVisualPreview: boolean;
  allowPublicBlobPreview?: boolean;
  previewReadonlyMode?: boolean;
  websiteDestination?: MarketingWebsiteDestinationReview | null;
  plans: PlanOption[];
  currentWeekPlanId: string | null;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onAddToPlanner: () => void;
};

/**
 * Content Queue review card: authenticated preview, full caption, approve/reject for needs_review.
 * Schedule/publish controls are intentionally omitted.
 */
export function ContentQueueReviewCard({
  item,
  previewUrl,
  showVisualPreview,
  allowPublicBlobPreview = false,
  previewReadonlyMode = false,
  websiteDestination = null,
  plans,
  currentWeekPlanId,
  busy,
  onApprove,
  onReject,
  onAddToPlanner,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const safePreview = resolveReviewCardImageSrc(previewUrl, allowPublicBlobPreview);
  const showImage = Boolean(showVisualPreview && safePreview && !imageFailed);
  const showUnavailable = showVisualPreview && (!safePreview || imageFailed);
  const displayTitle = contentDisplayTitle(item.title, item.body);
  const week = formatContentWeekLabel(item.weeklyPlanId, plans);
  const onCurrentWeek =
    item.weeklyPlanId && currentWeekPlanId && item.weeklyPlanId === currentWeekPlanId;
  const canReview = !previewReadonlyMode && contentQueueShowsApproveReject(item.status);
  const canAddToPlanner = !previewReadonlyMode && contentCanEnqueueToPlanner(item);
  const inPlanner = contentShowsInPlanner(item);

  function handleReject() {
    if (busy) return;
    const ok = window.confirm(contentQueueRejectConfirmMessage(item.title, item.platform));
    if (!ok) return;
    onReject();
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} />
            {inPlanner ? (
              <span className="rounded-full border border-brand-green-deep/35 bg-brand-green-deep/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-green-deep">
                In planner
              </span>
            ) : null}
            <StatusPill status={item.platform} />
            <StatusPill status={item.category} />
            <StatusPill status={item.audience} />
          </div>

          {displayTitle ? (
            <h3 className="text-lg font-extrabold text-brand-charcoal">{displayTitle}</h3>
          ) : null}

          {showImage && safePreview ? (
            <div className="max-w-md overflow-hidden rounded-2xl border border-brand-brown/15 bg-cream-deep">
              <div className="relative max-h-80 w-full">
                <ReviewPreviewImage
                  kind={safePreview.kind}
                  src={safePreview.src}
                  alt={
                    displayTitle
                      ? `Creative preview for ${displayTitle}`
                      : `${item.platform} creative preview`
                  }
                  className="h-auto max-h-80 w-full object-contain"
                  onError={() => setImageFailed(true)}
                />
              </div>
            </div>
          ) : null}

          {showUnavailable ? (
            <div
              className="flex max-w-md items-center justify-center rounded-2xl border border-dashed border-brand-brown/25 bg-cream-deep/60 px-4 py-10 text-sm text-brand-charcoal/55"
              role="status"
            >
              {reviewCardPreviewUnavailableMessage(previewUrl, allowPublicBlobPreview)}
            </div>
          ) : null}

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              Full caption
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-brand-charcoal">{item.body}</p>
          </div>

          {item.cta?.trim() ? (
            <p className="text-xs font-semibold text-brand-navy">CTA field: {item.cta.trim()}</p>
          ) : null}

          {websiteDestination ? <WebsiteDestinationReview review={websiteDestination} /> : null}

          <p className="text-xs text-brand-charcoal/55">
            Created {formatContentCreatedAt(item.createdAt)}
          </p>
          <p className="text-xs text-brand-charcoal/55">
            Week: <span className="font-semibold">{week.label}</span>
            {item.weeklyPlanId && !onCurrentWeek ? (
              <span className="text-brand-charcoal/45">
                {" "}
                (not the plan shown on Your week — assign a week from the Calendar planner when ready)
              </span>
            ) : null}
            {onCurrentWeek ? (
              <span className="text-brand-charcoal/45"> · visible on Your week now</span>
            ) : null}
          </p>

          {previewReadonlyMode ? (
            <p className="text-xs font-semibold text-brand-charcoal/60" role="status">
              Marketing preview is read-only — approve, reject, and planner actions are disabled.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canAddToPlanner ? (
              <SecondaryButton type="button" disabled={busy} onClick={onAddToPlanner}>
                Add to Planner
              </SecondaryButton>
            ) : null}
            {inPlanner ? (
              <Link
                href="/admin/marketing/calendar#planning-queue"
                className="text-xs font-bold text-brand-navy underline"
              >
                Open planning queue
              </Link>
            ) : null}
            {item.status !== "approved" && !canReview ? (
              <p className="text-xs text-brand-charcoal/50">Approve content before adding to the planner.</p>
            ) : null}
          </div>
        </div>

        {canReview ? (
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-40">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/55">
              Review
            </p>
            <PrimaryButton type="button" disabled={busy} onClick={onApprove}>
              Approve
            </PrimaryButton>
            <SecondaryButton type="button" disabled={busy} onClick={handleReject}>
              Reject
            </SecondaryButton>
            <p className="text-xs leading-snug text-brand-charcoal/50">
              Approve marks content ready for the planner. It does not schedule or publish.
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
