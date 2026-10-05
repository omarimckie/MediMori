import { requireMarketingAdmin } from "@/lib/marketing/http";
import { disablePushSubscriptionForAdmin } from "@/lib/marketing/notifications/notifications-repository";
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

  const endpoint =
    typeof body === "object" &&
    body !== null &&
    "endpoint" in body &&
    typeof (body as { endpoint: unknown }).endpoint === "string"
      ? (body as { endpoint: string }).endpoint.trim()
      : "";
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required." }, { status: 400 });
  }

  const ok = await disablePushSubscriptionForAdmin(auth.username, endpoint);
  return NextResponse.json({ ok });
}
