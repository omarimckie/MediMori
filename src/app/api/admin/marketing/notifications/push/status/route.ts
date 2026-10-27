import { requireMarketingAdmin } from "@/lib/marketing/http";
import { listEnabledPushSubscriptionsForAdmin } from "@/lib/marketing/notifications/notifications-repository";
import { getWebPushVapidPublicKey } from "@/lib/marketing/notifications/vapid";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  if (!auth.username) {
    return NextResponse.json({ error: "Admin username missing." }, { status: 401 });
  }

  const endpoint = new URL(request.url).searchParams.get("endpoint")?.trim() ?? "";
  const subscriptions = await listEnabledPushSubscriptionsForAdmin(auth.username);
  const enabledOnThisDevice = endpoint
    ? subscriptions.some((row) => row.endpoint === endpoint)
    : false;

  return NextResponse.json({
    pushConfigured: Boolean(getWebPushVapidPublicKey()),
    enabledSubscriptionCount: subscriptions.length,
    enabledOnThisDevice,
  });
}
