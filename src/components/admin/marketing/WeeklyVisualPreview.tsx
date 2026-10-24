import {
  explicitPublicMarketingBlobReviewUrl,
  resolveReviewCardImageSrc,
} from "@/lib/marketing/content-queue-review";
import type { WeeklyItemReview } from "@/lib/marketing/weekly-review";
import { ReviewPreviewImage } from "./ReviewPreviewImage";

export type WeeklyVisualPreviewProps = {
  review?: WeeklyItemReview | null;
  title: string | null;
  allowPublicBlobPreview?: boolean;
};

/**
 * Visual block for weekly approval. Renders nothing when the item is not visual
 * or has no resolved preview URL (no empty placeholder box).
 */
export function WeeklyVisualPreview({
  review,
  title,
  allowPublicBlobPreview = false,
}: WeeklyVisualPreviewProps) {
  if (!review?.showVisualPreview || !review.previewUrl) {
    return null;
  }

  const publicBlob = explicitPublicMarketingBlobReviewUrl(review.previewUrl);
  const resolved = resolveReviewCardImageSrc(review.previewUrl, allowPublicBlobPreview);
  const image = publicBlob
    ? allowPublicBlobPreview && resolved?.kind === "public-blob"
      ? resolved
      : null
    : (resolved ?? { kind: "legacy" as const, src: review.previewUrl });

  if (!image && !review.dimensionsLabel && !review.visualSuitabilityWarning) {
    return null;
  }

  return (
    <div className="mt-3 max-w-md">
      {image ? (
        <div className="overflow-hidden rounded-2xl border border-brand-brown/15 bg-cream-deep">
          <div className="relative max-h-80 w-full">
            <ReviewPreviewImage
              kind={image.kind}
              src={image.src}
              alt={title?.trim() ? `Selected creative for ${title}` : "Selected creative"}
              className="h-auto max-h-80 w-full object-contain"
              loading="eager"
            />
          </div>
        </div>
      ) : null}
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
