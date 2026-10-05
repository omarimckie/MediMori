import { requireMarketingAdmin } from "@/lib/marketing/http";
import {
  countUnreadAdminNotifications,
  listAdminNotifications,
  markAllAdminNotificationsRead,
} from "@/lib/marketing/notifications/notifications-repository";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const [notifications, unreadCount] = await Promise.all([
    listAdminNotifications({ limit: 50 }),
    countUnreadAdminNotifications(),
  ]);
  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const action =
    typeof body === "object" && body !== null && "action" in body
      ? String((body as { action: unknown }).action)
      : "";
  if (action === "mark_all_read") {
    const count = await markAllAdminNotificationsRead();
    return NextResponse.json({ ok: true, marked: count });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
