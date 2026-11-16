import { jsonError, requireMarketingAdminMutation } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { createPlannerE2eStagingFixtures } from "@/lib/marketing/planner-e2e-fixtures";
import { PlannerStagingE2eFixtureScopeError } from "@/lib/marketing/planner-staging-e2e-gate";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdminMutation(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await createPlannerE2eStagingFixtures(getMarketingStore());
    return NextResponse.json({ ok: true, fixtures: result });
  } catch (error) {
    if (error instanceof PlannerStagingE2eFixtureScopeError) {
      return jsonError(error.message, 403);
    }
    const message = error instanceof Error ? error.message : "Fixture creation failed.";
    return jsonError(message, 500);
  }
}