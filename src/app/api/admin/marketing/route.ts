import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { overview } from "@/lib/marketing/workflow";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const data = await overview(getMarketingStore());
  return NextResponse.json(data);
}
