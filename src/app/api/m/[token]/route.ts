import { getMarketingStore } from "@/lib/marketing/context";
import { buildTrackingRedirect, persistMarketingClick } from "@/lib/marketing/tracking";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const store = getMarketingStore();
  const content = await store.getContentByToken(token);
  const redirectUrl = buildTrackingRedirect(request.url, content);
  if (content) {
    await persistMarketingClick(store, content, token);
  }
  return NextResponse.redirect(redirectUrl);
}
