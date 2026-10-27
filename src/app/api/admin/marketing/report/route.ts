import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { buildWeeklyReport } from "@/lib/marketing/report";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const campaignId = new URL(request.url).searchParams.get("campaignId") ?? undefined;
  const report = await buildWeeklyReport(getMarketingStore(), campaignId);
  return NextResponse.json({ report });
}
