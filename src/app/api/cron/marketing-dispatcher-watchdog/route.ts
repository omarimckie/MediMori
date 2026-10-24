import { handleMarketingDispatcherWatchdogCron } from "@/lib/marketing/reliability/dispatcher-watchdog/handle-marketing-dispatcher-watchdog-cron";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const outcome = await handleMarketingDispatcherWatchdogCron(request);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
