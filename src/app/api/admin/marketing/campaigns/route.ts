import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { createCampaignWorkflow } from "@/lib/marketing/workflow";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const campaigns = await getMarketingStore().listCampaigns();
  return NextResponse.json({ campaigns });
}

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const objective =
    typeof body === "object" &&
    body !== null &&
    "objective" in body &&
    typeof (body as { objective: unknown }).objective === "string"
      ? (body as { objective: string }).objective.trim()
      : "";
  if (!objective) return jsonError("objective is required.");
  const campaign = await createCampaignWorkflow(
    getMarketingStore(),
    objective,
    auth.username,
  );
  return NextResponse.json({ campaign });
}
