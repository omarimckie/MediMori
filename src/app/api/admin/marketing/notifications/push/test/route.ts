import { requireMarketingAdmin } from "@/lib/marketing/http";
import { sendTestMarketingNotification } from "@/lib/marketing/notifications/send-marketing-notification";
import { getWebPushVapidPublicKey } from "@/lib/marketing/notifications/vapid";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  if (!auth.username) {
    return NextResponse.json({ error: "Admin username missing." }, { status: 401 });
  }
  if (!getWebPushVapidPublicKey()) {
    return NextResponse.json(
      { error: "Web Push is not configured (missing VAPID keys)." },
      { status: 503 },
    );
  }

  const result = await sendTestMarketingNotification(auth.username);
  return NextResponse.json({
    ok: result.pushDelivered > 0,
    notificationId: result.notification.id,
    pushAttempted: result.pushAttempted,
    pushDelivered: result.pushDelivered,
    deliveryStatus: result.notification.deliveryStatus,
  });
}
