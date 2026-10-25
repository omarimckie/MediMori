import { buildMarketingAnalyticsDashboard } from "@/lib/marketing/analytics/analytics-aggregation";
import {
  parseAnalyticsAnchorParam,
  parseAnalyticsWindowParam,
} from "@/lib/marketing/analytics/analytics-query";
import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const window = parseAnalyticsWindowParam(url.searchParams.get("window"));
  const anchor = parseAnalyticsAnchorParam(url.searchParams.get("anchor"));
  try {
    const store = getMarketingStore();
    const dashboard = await buildMarketingAnalyticsDashboard({
      store,
      window,
      anchor,
    });
    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "analytics_dashboard_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
