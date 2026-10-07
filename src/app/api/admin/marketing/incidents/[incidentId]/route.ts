import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getIncidentDetail } from "@/lib/marketing/incidents/admin-queries";
import {
  serializeIncidentEventForApi,
  serializeIncidentForApi,
} from "@/lib/marketing/incidents/api-serialization";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ incidentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const { incidentId } = await context.params;
  const detail = await getIncidentDetail(incidentId);
  if (!detail) {
    return NextResponse.json({ error: "Incident not found." }, { status: 404 });
  }

  return NextResponse.json({
    incident: serializeIncidentForApi(detail.incident),
    events: detail.events.map(serializeIncidentEventForApi),
    notifications: detail.notifications,
  });
}
