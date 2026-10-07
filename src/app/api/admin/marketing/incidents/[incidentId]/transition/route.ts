import { requireMarketingAdmin } from "@/lib/marketing/http";
import {
  adminTransitionIncident,
  incidentHttpError,
} from "@/lib/marketing/incidents/admin-http";
import { serializeIncidentForApi } from "@/lib/marketing/incidents/api-serialization";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ incidentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const { incidentId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.trim() : "";
  const incidentVersion = Number(record.incidentVersion);
  if (!status) {
    return NextResponse.json({ error: "status is required." }, { status: 400 });
  }
  if (!Number.isInteger(incidentVersion) || incidentVersion < 1) {
    return NextResponse.json({ error: "incidentVersion is required." }, { status: 400 });
  }

  try {
    const incident = await adminTransitionIncident({
      incidentId,
      status,
      incidentVersion,
      actor: auth.username ?? "marketing_admin",
    });
    return NextResponse.json({ incident: serializeIncidentForApi(incident) });
  } catch (error) {
    const mapped = incidentHttpError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    throw error;
  }
}
