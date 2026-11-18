import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  listPlannerQueue,
  parsePlannerQueuePagination,
} from "@/lib/marketing/content-planner-queue";
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

  const result = await listPlannerQueue(getMarketingStore(), { limit, offset, platform });
  return NextResponse.json(result);
}
