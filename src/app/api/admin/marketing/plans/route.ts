import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { createEmptyWeeklyPlan } from "@/lib/marketing/empty-weekly-plan";
import { WeeklyPlanDateError } from "@/lib/marketing/weekly-plan-dates";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  let body: { weekStart?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (body.weekStart === undefined || body.weekStart === null) {
    return jsonError("weekStart is required.", 400);
  }

  try {
    const result = await createEmptyWeeklyPlan(getMarketingStore(), {
      weekStart: String(body.weekStart),
      campaignId: null,
    });
    return NextResponse.json({
      plan: result.plan,
      created: result.created,
      normalizedWeekStart: result.normalizedWeekStart,
    });
  } catch (error) {
    if (error instanceof WeeklyPlanDateError) {
      return jsonError(error.message, 400);
    }
    const message = error instanceof Error ? error.message : "Could not create week.";
    return jsonError(message, 500);
  }
}
