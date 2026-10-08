import { requireMarketingAdmin } from "@/lib/marketing/http";
import {
  buildCredentialHealthDashboardView,
  serializeCredentialHealthDashboardForApi,
} from "@/lib/marketing/credential-health/admin-dashboard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const view = await buildCredentialHealthDashboardView();
  return NextResponse.json(serializeCredentialHealthDashboardForApi(view));
}
