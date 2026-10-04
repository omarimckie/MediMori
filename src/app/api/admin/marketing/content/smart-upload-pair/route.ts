import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { resolveSmartUploadPairForContent } from "@/lib/marketing/content-assign-week";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const contentId = new URL(request.url).searchParams.get("contentId")?.trim() ?? "";
  if (!contentId) return jsonError("contentId is required.", 400);

  const store = getMarketingStore();
  const content = await store.getContent(contentId);
  if (!content) return jsonError("Content not found.", 404);

  const pair = await resolveSmartUploadPairForContent(store, content);
  return NextResponse.json({ pair });
}
