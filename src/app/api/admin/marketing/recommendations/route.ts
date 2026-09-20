import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { decideRecommendation, generateRecommendations } from "@/lib/marketing/recommendations";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const recommendations = await getMarketingStore().listRecommendations();
  return NextResponse.json({ recommendations });
}

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  let body: { action?: string; campaignId?: string; id?: string; status?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const store = getMarketingStore();
  if (body.action === "generate") {
    const recommendations = await generateRecommendations(store, body.campaignId);
    return NextResponse.json({ recommendations });
  }
  if (
    body.action === "decide" &&
    body.id &&
    (body.status === "accepted" || body.status === "rejected" || body.status === "dismissed")
  ) {
    const recommendation = await decideRecommendation(store, body.id, body.status);
    return NextResponse.json({ recommendation });
  }
  return jsonError("Unsupported action.");
}
