"use client";

import { contentDisplayTitle } from "@/lib/marketing/content-client-utils";
import {
  resolveReviewCardImageSrc,
  reviewCardPreviewUnavailableMessage,
} from "@/lib/marketing/content-queue-review";
import type { WeeklyItemReview } from "@/lib/marketing/weekly-review";
import { useEffect, useId, useRef } from "react";
import { ReviewPreviewImage } from "./ReviewPreviewImage";
import { SecondaryButton, StatusPill } from "./ui";

type Props = {
  open: boolean;
  busy: boolean;
  title: string | null;
  body: string;
  platform: string;
  previewUrl: string | null;
  showVisualPreview: boolean;
  allowPublicBlobPreview: boolean;
  review: WeeklyItemReview | null;
  onClose: () => void;
};

export function PlanningQueuePreviewModal({
  open,
  busy,
  title,
  body,
  platform,
  previewUrl,
  showVisualPreview,
  allowPublicBlobPreview,
  review,
  onClose,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const displayTitle = contentDisplayTitle(title, body);
  const safePreview = resolveReviewCardImageSrc(previewUrl, allowPublicBlobPreview);
  const channelLabel = review?.channelLabel ?? platform;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/45 p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-brand-brown/20 bg-cream p-5 shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={platform} />
          <span className="text-xs font-semibold text-brand-charcoal/70">{channelLabel}</span>
        </div>
        <h2 id={titleId} className="mt-3 font-display text-xl text-brand-navy">
          {displayTitle || "Planning queue preview"}
        </h2>
        {review?.dimensionsLabel ? (
          <p className="mt-1 text-xs text-brand-charcoal/60">{review.dimensionsLabel}</p>
        ) : null}

        {showVisualPreview && safePreview ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-brand-brown/15 bg-cream-deep">
            <div className="relative max-h-[min(70vh,28rem)] w-full">
              <ReviewPreviewImage
                kind={safePreview.kind}
                src={safePreview.src}
                alt={displayTitle ? `Full preview for ${displayTitle}` : `${platform} creative preview`}
                className="h-auto max-h-[min(70vh,28rem)] w-full object-contain"
                loading="eager"
              />
            </div>
          </div>
        ) : (
          <div
            className="mt-4 flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-brand-brown/25 bg-cream-deep/60 px-4 text-sm text-brand-charcoal/55"
            role="status"
          >
            {reviewCardPreviewUnavailableMessage(previewUrl, allowPublicBlobPreview)}
          </div>
        )}

        <ModalCloseActions busy={busy} onClose={onClose} />
      </div>
    </div>
  );
}

function ModalCloseActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="mt-5 flex justify-end">
      <SecondaryButton type="button" disabled={busy} onClick={onClose}>
        Close
      </SecondaryButton>
    </div>
  );
}