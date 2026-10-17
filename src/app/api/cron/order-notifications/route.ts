import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  cronAuthDecision,
  getCronSecret,
  isProductionRuntime,
} from "@/lib/marketing/config";
import { retryFailedOwnerOrderPushesLive } from "@/lib/order-notifications/owner-push-live";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function handle(request: Request) {
  const decision = cronAuthDecision({
    isProduction: isProductionRuntime(),
    cronSecret: getCronSecret(),
    authorizationHeader: request.headers.get("authorization"),
    isAdmin: await isAdminAuthenticated(),
  });
  if (!decision.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await retryFailedOwnerOrderPushesLive();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
