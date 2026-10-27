import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { generateWeekWorkflow } from "@/lib/marketing/workflow";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const campaign = await getMarketingStore().getCampaign(id);
  if (!campaign) return jsonError("Campaign not found.", 404);
  return NextResponse.json({ campaign });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    body = {};
  }
  if (body.action && body.action !== "generate_week") {
    return jsonError("Unsupported action.");
  }
  const result = await generateWeekWorkflow(getMarketingStore(), id);
  return NextResponse.json(result);
}
