import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { attributePurchases, loadPurchaseSnapshots } from "@/lib/marketing/attribution";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const store = getMarketingStore();
  const metrics = await store.listMetrics();
  const events = await store.listEvents();
  const clicks = await store.listClicks();
  const purchases = await loadPurchaseSnapshots();
  const attribution = await attributePurchases(store, purchases);
  return NextResponse.json({ metrics, events, clicks, attribution });
}
