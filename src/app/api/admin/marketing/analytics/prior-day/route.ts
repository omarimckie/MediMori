import {
  buildPriorDayAnalyticsNotificationPayload,
  buildPriorDayAnalyticsSummary,
} from "@/lib/marketing/analytics/prior-day-analytics-summary";
import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Read-only preview for push copy. Does not deliver notifications. */
export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  try {
    const store = getMarketingStore();
    const summary = await buildPriorDayAnalyticsSummary(store);
    const payload = buildPriorDayAnalyticsNotificationPayload(summary);
    return NextResponse.json(
      {
        summary,
        pushPayloadPreview: payload,
        deliverable: false,
        note: "Preview only. Morning brief cron uses the same summary builder; live push requires VAPID and subscriptions.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "prior_day_analytics_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
