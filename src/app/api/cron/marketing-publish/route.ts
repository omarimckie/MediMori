import { cronAuthDecision, getCronSecret, isProductionRuntime } from "@/lib/marketing/config";
import { getMarketingStore } from "@/lib/marketing/context";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { publishDue } from "@/lib/marketing/approval";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function authorizeMarketingCron(request: Request) {
  return cronAuthDecision({
    isProduction: isProductionRuntime(),
    cronSecret: getCronSecret(),
    authorizationHeader: request.headers.get("authorization"),
    isAdmin: await isAdminAuthenticated(),
  });
}

export async function POST(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await publishDue(getMarketingStore());
  return NextResponse.json({ published: results.length, results });
}

export async function GET(request: Request) {
  return POST(request);
}
