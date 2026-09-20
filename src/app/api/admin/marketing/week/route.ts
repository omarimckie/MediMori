import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { runApprovalAction } from "@/lib/marketing/workflow";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  let body: { action?: string; weeklyPlanId?: string; feedback?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.");
  }
  if (body.action !== "approve_all" && body.action !== "reject_all") {
    return jsonError("Unsupported action.");
  }
  if (!body.weeklyPlanId) return jsonError("weeklyPlanId is required.");
  const result = await runApprovalAction(getMarketingStore(), {
    action: body.action,
    weeklyPlanId: body.weeklyPlanId,
    feedback: body.feedback,
    actor: auth.username,
  });
  return NextResponse.json({ result });
}
