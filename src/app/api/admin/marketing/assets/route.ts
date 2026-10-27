import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const assets = await getMarketingStore().listAssets();
  return NextResponse.json({ assets });
}
