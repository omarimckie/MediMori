import { projectEngineeringAdminEventDetails } from "./admin-engineering-event-details";

export type EngineeringAdminHistoryEvent = {
  id?: string;
  actor?: string;
  action: unknown;
  created_at?: string;
  details: unknown;
};

export type EngineeringAdminGetDeps = {
  isAuthenticated: () => Promise<boolean>;
  controlPlaneEnabled: boolean;
  getTaskHistory: (taskId: string) => Promise<{ events: EngineeringAdminHistoryEvent[] }>;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Testable core of authenticated engineering admin GET history projection (task id branch). */
export async function engineeringAdminGetTaskHistoryResponse(
  request: Request,
  deps: EngineeringAdminGetDeps,
): Promise<Response> {
  if (!await deps.isAuthenticated()) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!deps.controlPlaneEnabled) {
    return Response.json({ error: "Engineering is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !uuid.test(id)) {
    return Response.json({ error: "Invalid task ID." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const history = await deps.getTaskHistory(id);
  const events = history.events.map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    created_at: row.created_at,
    details: projectEngineeringAdminEventDetails(row.action, row.details),
  }));
  return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
