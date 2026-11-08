import { runCredentialHealthDailyCron } from "@/lib/marketing/credential-health/run-credential-health-daily";
import { runtimeCredentialProbeFetch } from "@/lib/marketing/credential-health/probes";
import { authorizeMarketingCron } from "@/lib/marketing/marketing-cron";
import {
  assertMarketingPreviewAllowsMutations,
  MarketingPreviewReadonlyError,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "@/lib/marketing/preview-readonly";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertMarketingPreviewAllowsMutations();
  } catch (error) {
    if (error instanceof MarketingPreviewReadonlyError) {
      return NextResponse.json(
        { error: MARKETING_PREVIEW_READONLY_MESSAGE },
        { status: 403 },
      );
    }
    throw error;
  }

  const auth = await authorizeMarketingCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await runCredentialHealthDailyCron({
    fetch: runtimeCredentialProbeFetch,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
