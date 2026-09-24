import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { buildWeeklyItemReview } from "@/lib/marketing/weekly-review";
import type { ContentFilters } from "@/lib/marketing/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const filters: ContentFilters = {};
  const campaignId = url.searchParams.get("campaignId");
  const weeklyPlanId = url.searchParams.get("weeklyPlanId");
  const platform = url.searchParams.get("platform");
  const audience = url.searchParams.get("audience");
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  if (campaignId) filters.campaignId = campaignId;
  if (weeklyPlanId) filters.weeklyPlanId = weeklyPlanId;
  if (platform) filters.platform = platform as ContentFilters["platform"];
  if (audience) filters.audience = audience as ContentFilters["audience"];
  if (category) filters.category = category as ContentFilters["category"];
  if (status) filters.status = status as ContentFilters["status"];
  const store = getMarketingStore();
  const content = await store.listContent(filters);
  const enrich = url.searchParams.get("enrich");
  if (enrich === "weekly") {
    const reviewByContentId: Record<string, Awaited<ReturnType<typeof buildWeeklyItemReview>>> =
      {};
    for (const item of content) {
      reviewByContentId[item.id] = await buildWeeklyItemReview(store, item);
    }
    return NextResponse.json({ content, reviewByContentId });
  }
  return NextResponse.json({ content });
}
