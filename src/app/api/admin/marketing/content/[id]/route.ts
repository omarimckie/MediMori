import { jsonError, requireMarketingAdmin, requireMarketingAdminMutation } from "@/lib/marketing/http";
import {
  isPlannerStagingE2eContentPostActionAllowed,
  plannerStagingE2eMutationBlockMessage,
} from "@/lib/marketing/planner-staging-e2e-gate";
import { evaluatePlannerStagingE2eHttpMutation } from "@/lib/marketing/planner-staging-e2e-gate";
import { getMarketingStore } from "@/lib/marketing/context";
import { executeMarketingContentPostAction } from "@/lib/marketing/content-post-action";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const store = getMarketingStore();
  const content = await store.getContent(id);
  if (!content) return jsonError("Content not found.", 404);
  const approvals = await store.listApprovals(id);
  return NextResponse.json({ content, approvals });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdminMutation(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  let body: {
    action?: string;
    body?: string;
    feedback?: string;
    scheduledFor?: string | null;
    confirmPermanentDelete?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const action = body.action;
  const decision = evaluatePlannerStagingE2eHttpMutation(
    `/api/admin/marketing/content/${id}`,
    "POST",
  );
  if (
    decision === "allow" &&
    action &&
    !isPlannerStagingE2eContentPostActionAllowed(action)
  ) {
    return jsonError(plannerStagingE2eMutationBlockMessage("deny_allowlist"), 403);
  }
  if (
    action !== "approve" &&
    action !== "reject" &&
    action !== "edit" &&
    action !== "regenerate" &&
    action !== "schedule" &&
    action !== "recycle" &&
    action !== "restore" &&
    action !== "delete_permanent"
  ) {
    return jsonError("Unsupported action.");
  }
  return executeMarketingContentPostAction(getMarketingStore(), {
    action,
    contentId: id,
    body: body.body,
    feedback: body.feedback,
    scheduledFor:
      action === "schedule" || action === "recycle" ? body.scheduledFor : undefined,
    confirmPermanentDelete: action === "delete_permanent" ? body.confirmPermanentDelete : undefined,
    actor: auth.username,
  });
}
