import { getMarketingStore } from "@/lib/marketing/context";
import { requireMarketingAdmin } from "@/lib/marketing/http";
import {
  getMorningBriefPreferences,
  setMorningBriefPreferences,
} from "@/lib/marketing/notifications/preferences";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const prefs = await getMorningBriefPreferences(getMarketingStore());
  return NextResponse.json({ preferences: prefs });
}

export async function PUT(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const prefs =
    typeof body === "object" && body !== null && "preferences" in body
      ? (body as { preferences: unknown }).preferences
      : body;
  const saved = await setMorningBriefPreferences(getMarketingStore(), prefs as never);
  return NextResponse.json({ preferences: saved });
}
