import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const operations = await getMarketingStore().listOperations();
  const estimatedCostUsd = operations.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  return NextResponse.json({ operations, estimatedCostUsd });
}
