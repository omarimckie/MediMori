import { getMarketingStore } from "@/lib/marketing/context";
import {
  authorizeMarketingCron,
  recordMarketingPublishDispatcherHeartbeat,
} from "@/lib/marketing/marketing-cron";
import { publishDue } from "@/lib/marketing/approval";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await publishDue(getMarketingStore());
  await recordMarketingPublishDispatcherHeartbeat({
    request,
    auth,
    publishedCount: results.length,
  });
  return NextResponse.json({ published: results.length, results });
}

export async function GET(request: Request) {
  return POST(request);
}
