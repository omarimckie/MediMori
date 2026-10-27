import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getWebPushVapidPublicKey } from "@/lib/marketing/notifications/vapid";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const publicKey = getWebPushVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "Web Push is not configured (missing VAPID keys)." },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey });
}
