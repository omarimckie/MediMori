import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  assignContentToWeeklyPlan,
  assignWeekErrorStatus,
  AssignContentToWeekError,
} from "@/lib/marketing/content-assign-week";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  let body: { contentIds?: unknown; weeklyPlanId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const weeklyPlanId = typeof body.weeklyPlanId === "string" ? body.weeklyPlanId : "";
  const rawIds = body.contentIds;
  if (!Array.isArray(rawIds)) {
    return jsonError("contentIds must be an array.", 400);
  }
  const contentIds = rawIds.filter((id): id is string => typeof id === "string");

  try {
    const result = await assignContentToWeeklyPlan(getMarketingStore(), {
      contentIds,
      weeklyPlanId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AssignContentToWeekError) {
      return jsonError(error.message, assignWeekErrorStatus(error));
    }
    const message = error instanceof Error ? error.message : "Assignment failed.";
    return jsonError(message, 500);
  }
}
