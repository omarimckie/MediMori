import { requireMarketingAdmin } from "@/lib/marketing/http";
import { upsertPushSubscription } from "@/lib/marketing/notifications/notifications-repository";
import { parsePushSubscriptionBody } from "@/lib/marketing/notifications/subscription-payload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  if (!auth.username) {
    return NextResponse.json({ error: "Admin username missing." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const subscription = parsePushSubscriptionBody(body);
  if (!subscription) {
    return NextResponse.json({ error: "Invalid PushSubscription payload." }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent");
  const saved = await upsertPushSubscription({
    adminUsername: auth.username,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    userAgent,
  });

  return NextResponse.json({
    ok: true,
    subscription: {
      id: saved.id,
      endpoint: saved.endpoint,
      enabled: saved.enabled,
    },
  });
}
