import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  listTikTokPublicationInventory,
  parseTikTokInventoryPagination,
} from "@/lib/marketing/buffer/buffer-tiktok-inventory";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const { limit, offset } = parseTikTokInventoryPagination(
    url.searchParams.get("limit"),
    url.searchParams.get("offset"),
  );

  const inventory = await listTikTokPublicationInventory(getMarketingStore(), { limit, offset });
  return NextResponse.json({ ok: true, ...inventory });
}