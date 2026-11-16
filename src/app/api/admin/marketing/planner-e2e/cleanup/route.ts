import { jsonError, requireMarketingAdminMutation } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  cleanupPlannerE2eStagingFixtures,
  PlannerStagingE2eCleanupError,
} from "@/lib/marketing/planner-e2e-cleanup";
import { PlannerStagingE2eFixtureScopeError } from "@/lib/marketing/planner-staging-e2e-gate";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdminMutation(request);
  if (!auth.ok) return auth.response;

  let body: { batchId?: unknown } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const batchId = typeof body.batchId === "string" ? body.batchId : undefined;

  try {
    const result = await cleanupPlannerE2eStagingFixtures(getMarketingStore(), { batchId });
    return NextResponse.json({ ok: true, cleanup: result });
  } catch (error) {
    if (error instanceof PlannerStagingE2eFixtureScopeError) {
      return jsonError(error.message, 403);
    }
    if (error instanceof PlannerStagingE2eCleanupError) {
      return jsonError(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Cleanup failed.";
    return jsonError(message, 500);
  }
}