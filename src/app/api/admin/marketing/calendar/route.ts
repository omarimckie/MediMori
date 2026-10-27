import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { listMarketingCalendarEvents } from "@/lib/marketing/marketing-calendar";
import { getMarketingTimezone } from "@/lib/marketing/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const store = getMarketingStore();
  const events = await listMarketingCalendarEvents(store);
  return NextResponse.json({
    events,
    marketingTimezone: getMarketingTimezone(),
  });
}
