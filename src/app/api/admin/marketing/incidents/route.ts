import { requireMarketingAdmin } from "@/lib/marketing/http";
import { listIncidents } from "@/lib/marketing/incidents/admin-queries";
import { serializeIncidentForApi } from "@/lib/marketing/incidents/api-serialization";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const unresolvedOnly = url.searchParams.get("unresolvedOnly") === "true";
  const publicationId = url.searchParams.get("publicationId");

  const incidents = await listIncidents({
    limit: Number.isFinite(limit) ? limit : undefined,
    unresolvedOnly,
    publicationId,
  });

  return NextResponse.json({
    incidents: incidents.map(serializeIncidentForApi),
  });
}
