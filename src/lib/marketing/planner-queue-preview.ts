import type { ContentListPreview } from "./content-list-preview";
import type { WeeklyItemReview } from "./weekly-review";

export type PlannerQueuePreviewById = Record<string, ContentListPreview>;

export type PlannerQueueReviewById = Record<string, WeeklyItemReview>;

export type PlannerQueueEnrichedResponse = {
  previewByContentId?: PlannerQueuePreviewById;
  reviewByContentId?: PlannerQueueReviewById;
  previewReadonlyImages?: boolean;
};

/** Default planner queue list uses preview enrichment for admin thumbnails. */
export function plannerQueueListRequestUrl(
  params?: { limit?: number; offset?: number; platform?: string; enrich?: "preview" | "none" },
): string {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  if (params?.platform) search.set("platform", params.platform);
  const enrich = params?.enrich ?? "preview";
  if (enrich === "preview") search.set("enrich", "preview");
  const query = search.toString();
  return `/api/admin/marketing/planner/queue${query ? `?${query}` : ""}`;
}