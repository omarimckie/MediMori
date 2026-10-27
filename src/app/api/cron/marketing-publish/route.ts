import { getMarketingStore } from "@/lib/marketing/context";
import {
  authorizeMarketingCron,
  recordMarketingPublishDispatcherHeartbeat,
} from "@/lib/marketing/marketing-cron";
import { publishDue } from "@/lib/marketing/approval";
import { runReliabilityAfterMarketingPublish } from "@/lib/marketing/reliability/post-publish-reliability";
import { handleMarketingPublishCron } from "@/lib/marketing/reliability/marketing-publish-cron";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const outcome = await handleMarketingPublishCron(request, {
    authorize: authorizeMarketingCron,
    getStore: getMarketingStore,
    publishDue,
    recordHeartbeat: recordMarketingPublishDispatcherHeartbeat,
    runReliabilityAfterMarketingPublish,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function GET(request: Request) {
  return POST(request);
}
