import { requireMarketingAdmin } from "@/lib/marketing/http";
import { markAdminNotificationRead } from "@/lib/marketing/notifications/notifications-repository";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { notificationId } = await context.params;
  const ok = await markAdminNotificationRead(notificationId);
  if (!ok) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
