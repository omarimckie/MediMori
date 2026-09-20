import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { brainSnapshot } from "@/lib/marketing/brain";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const store = getMarketingStore();
  const [rules, preferences, templates] = await Promise.all([
    store.listRules(),
    store.listPreferences(),
    store.listTemplates(),
  ]);
  return NextResponse.json({
    brain: brainSnapshot(),
    rules,
    preferences,
    templates,
  });
}
