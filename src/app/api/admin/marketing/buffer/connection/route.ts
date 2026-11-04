import { requireMarketingAdmin } from "@/lib/marketing/http";
import {
  runBufferConnectionDiagnostic,
  serializeBufferConnectionDiagnosticForApi,
} from "@/lib/marketing/buffer-connection-diagnostic";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Read-only Buffer GraphQL connection diagnostic (organizations + TikTok channel IDs). */
export async function GET() {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const result = await runBufferConnectionDiagnostic();
  const status = result.ok ? 200 : result.errorCode === "token_missing" ? 503 : 502;
  return NextResponse.json(serializeBufferConnectionDiagnosticForApi(result), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
