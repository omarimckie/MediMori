import { getMarketingStore } from "@/lib/marketing/context";
import { requireMarketingAdmin } from "@/lib/marketing/http";
import { buildMorningMarketingBrief } from "@/lib/marketing/notifications/morning-brief";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Preview only — does not send push or schedule delivery. */
export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const brief = await buildMorningMarketingBrief(getMarketingStore());
  return NextResponse.json({
    brief,
    note: "Morning Brief delivery is not scheduled in this milestone.",
  });
}
