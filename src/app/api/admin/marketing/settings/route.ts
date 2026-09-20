import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { DEFAULT_CHANNEL_QUOTAS, parseChannelQuotas } from "@/lib/marketing/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const store = getMarketingStore();
  const quotas = parseChannelQuotas(
    await store.getSetting("channel_quotas", DEFAULT_CHANNEL_QUOTAS),
  );
  const plans = await store.listWeeklyPlans();
  const publications = await store.listPublications();
  return NextResponse.json({ quotas, plans, publications });
}

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  let body: { quotas?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const quotas = parseChannelQuotas(body.quotas);
  await getMarketingStore().setSetting("channel_quotas", quotas);
  return NextResponse.json({ quotas });
}
