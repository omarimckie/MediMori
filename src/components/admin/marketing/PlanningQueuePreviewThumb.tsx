"use client";

import { useState } from "react";
import {
  resolveReviewCardImageSrc,
  reviewCardPreviewUnavailableMessage,
} from "@/lib/marketing/content-queue-review";
import { ReviewPreviewImage } from "./ReviewPreviewImage";

type Props = {
  contentId: string;
  platform: string;
  title: string | null;
  previewUrl: string | null;
  showVisualPreview: boolean;
  allowPublicBlobPreview: boolean;
  disabled?: boolean;
  onExpand: () => void;
};

export function PlanningQueuePreviewThumb({
  platform,
  title,
  previewUrl,
  showVisualPreview,
  allowPublicBlobPreview,
  disabled = false,
  onExpand,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const safePreview = resolveReviewCardImageSrc(previewUrl, allowPublicBlobPreview);
  const showImage = Boolean(showVisualPreview && safePreview && !imageFailed);
  const showUnavailable = showVisualPreview && (!safePreview || imageFailed);
  const alt = title?.trim()
    ? `Thumbnail for ${title}`
    : `${platform} planning queue thumbnail`;

  if (!showVisualPreview) {
    return (
      <div
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-brand-brown/25 bg-cream-deep/60 text-[10px] font-semibold uppercase tracking-wide text-brand-charcoal/45"
        role="status"
      >
        Text
      </div>
    );
  }

  if (showImage && safePreview) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onExpand}
        className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-brand-brown/15 bg-cream-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-deep disabled:opacity-60 sm:h-24 sm:w-24"
        aria-label={title?.trim() ? `Expand preview for ${title}` : `Expand ${platform} preview`}
      >
        <ReviewPreviewImage
          kind={safePreview.kind}
          src={safePreview.src}
          alt={alt}
          className="h-full w-full object-cover"
          width={96}
          height={96}
          onError={() => setImageFailed(true)}
        />
        <span className="sr-only">Click to expand image preview</span>
      </button>
    );
  }

  if (showUnavailable) {
    return (
      <div
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-brand-brown/25 bg-cream-deep/60 px-1 text-center text-[9px] font-medium leading-tight text-brand-charcoal/50 sm:h-24 sm:w-24"
        role="status"
      >
        {reviewCardPreviewUnavailableMessage(previewUrl, allowPublicBlobPreview)}
      </div>
    );
  }

  return (
    <div
      className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-brand-brown/25 bg-cream-deep/60 text-[10px] text-brand-charcoal/45 sm:h-24 sm:w-24"
      role="status"
    >
      No preview
    </div>
  );
}