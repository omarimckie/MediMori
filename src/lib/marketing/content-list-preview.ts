import { buildWeeklyItemReview } from "./weekly-review";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

export type ContentListPreview = {
  previewUrl: string | null;
  showVisualPreview: boolean;
  websiteDestination: Awaited<
    ReturnType<typeof buildWeeklyItemReview>
  >["websiteDestination"];
};

export async function buildContentListPreviewById(
  store: MarketingStore,
  content: MarketingContent[],
): Promise<Record<string, ContentListPreview>> {
  const previewByContentId: Record<string, ContentListPreview> = {};
  for (const item of content) {
    const review = await buildWeeklyItemReview(store, item);
    previewByContentId[item.id] = {
      previewUrl: review.previewUrl,
      showVisualPreview: review.showVisualPreview,
      websiteDestination: review.websiteDestination,
    };
  }
  return previewByContentId;
}
