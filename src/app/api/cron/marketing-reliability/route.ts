import { authorizeMarketingCron } from "@/lib/marketing/marketing-cron";
import { runMarketingReliabilitySweep } from "@/lib/marketing/reliability/sweep";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await runMarketingReliabilitySweep();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
