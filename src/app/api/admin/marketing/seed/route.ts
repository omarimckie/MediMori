import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { allowMarketingDemoSeed } from "@/lib/marketing/config";
import { getMarketingStore } from "@/lib/marketing/context";
import { seedMarketing } from "@/lib/marketing/seed";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  if (!allowMarketingDemoSeed()) {
    return jsonError("Demo seed is disabled in production.", 403);
  }
  const result = await seedMarketing(getMarketingStore());
  return NextResponse.json(result);
}
