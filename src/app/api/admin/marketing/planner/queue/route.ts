import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { buildContentListPreviewById } from "@/lib/marketing/content-list-preview";
import {
  listPlannerQueue,
  parsePlannerQueuePagination,
} from "@/lib/marketing/content-planner-queue";
import { isMarketingPreviewReadonly } from "@/lib/marketing/preview-readonly";
import { buildWeeklyItemReview } from "@/lib/marketing/weekly-review";
import type { Platform } from "@/lib/marketing/types";
import { PLATFORMS } from "@/lib/marketing/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { limit, offset } = parsePlannerQueuePagination(
    url.searchParams.get("limit"),
    url.searchParams.get("offset"),
  );
  const platformParam = url.searchParams.get("platform");
  let platform: Platform | undefined;
  if (platformParam) {
    if (!PLATFORMS.includes(platformParam as Platform)) {
      return NextResponse.json({ error: "Invalid platform." }, { status: 400 });
    }
    platform = platformParam as Platform;
  }

  const store = getMarketingStore();
  const result = await listPlannerQueue(store, { limit, offset, platform });
  const enrich = url.searchParams.get("enrich");
  if (enrich === "preview") {
    const previewByContentId = await buildContentListPreviewById(store, result.content);
    const reviewByContentId: Record<string, Awaited<ReturnType<typeof buildWeeklyItemReview>>> =
      {};
    for (const item of result.content) {
      reviewByContentId[item.id] = await buildWeeklyItemReview(store, item);
    }
    return NextResponse.json({
      ...result,
      previewByContentId,
      reviewByContentId,
      previewReadonlyImages: isMarketingPreviewReadonly(),
    });
  }
  return NextResponse.json(result);
}
