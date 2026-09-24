import Image from "next/image";
import type { WeeklyItemReview } from "@/lib/marketing/weekly-review";

export type WeeklyVisualPreviewProps = {
  review?: WeeklyItemReview | null;
  title: string | null;
};

/**
 * Visual block for weekly approval. Renders nothing when the item is not visual
 * or has no resolved preview URL (no empty placeholder box).
 */
export function WeeklyVisualPreview({ review, title }: WeeklyVisualPreviewProps) {
  if (!review?.showVisualPreview || !review.previewUrl) {
    return null;
  }

  return (
    <div className="mt-3 max-w-md">
      <div className="overflow-hidden rounded-2xl border border-brand-brown/15 bg-cream-deep">
        <div className="relative max-h-80 w-full">
          <Image
            src={review.previewUrl}
            alt={title?.trim() ? `Selected creative for ${title}` : "Selected creative"}
            width={800}
            height={1200}
            className="h-auto max-h-80 w-full object-contain"
            unoptimized
          />
        </div>
      </div>
      {review.dimensionsLabel ? (
        <p className="mt-2 text-xs text-brand-charcoal/60">{review.dimensionsLabel}</p>
      ) : null}
      {review.visualSuitabilityWarning ? (
        <p className="mt-2 text-xs font-semibold text-brand-orange-deep">
          ⚠️ {review.visualSuitabilityWarning}
        </p>
      ) : null}
    </div>
  );
}
