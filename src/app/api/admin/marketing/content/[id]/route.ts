import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { runApprovalAction } from "@/lib/marketing/workflow";
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
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  let body: { action?: string; body?: string; feedback?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const action = body.action;
  if (
    action !== "approve" &&
    action !== "reject" &&
    action !== "edit" &&
    action !== "regenerate" &&
    action !== "schedule"
  ) {
    return jsonError("Unsupported action.");
  }
  const result = await runApprovalAction(getMarketingStore(), {
    action,
    contentId: id,
    body: body.body,
    feedback: body.feedback,
    actor: auth.username,
  });
  return NextResponse.json({ result });
}
