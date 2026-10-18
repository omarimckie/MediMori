import {
  buildCentralAgentStatusFromTasks,
  buildDisconnectedCentralAgentStatus,
  serializeCentralAgentStatusDocument,
} from "./projection";
import {
  isCentralAgentStatusBearerConfigured,
  isCentralAgentStatusEndpointEnabled,
  verifyCentralAgentStatusBearer,
} from "./auth";
import { listTasksForStatus } from "./read-model";

export type CentralAgentStatusDeps = {
  isEnabled?: () => boolean;
  isBearerConfigured?: () => boolean;
  verifyBearer?: (request: Request) => boolean;
  isControlPlaneEnabled?: () => boolean;
  listTasksForStatusImpl?: typeof listTasksForStatus;
};

export async function centralAgentStatusGet(
  request: Request,
  deps: CentralAgentStatusDeps = {},
): Promise<Response> {
  const isEnabled = deps.isEnabled ?? isCentralAgentStatusEndpointEnabled;
  const isBearerConfigured = deps.isBearerConfigured ?? isCentralAgentStatusBearerConfigured;
  const verifyBearer = deps.verifyBearer ?? verifyCentralAgentStatusBearer;
  const isControlPlaneEnabled =
    deps.isControlPlaneEnabled ?? (() => process.env.ENGINEERING_CONTROL_PLANE_ENABLED === "true");
  const listTasksForStatusImpl = deps.listTasksForStatusImpl ?? listTasksForStatus;

  if (!isEnabled()) {
    return Response.json(
      { error: "Central agent status endpoint is disabled." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isBearerConfigured()) {
    return Response.json(
      { error: "Central agent status bearer is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!verifyBearer(request)) {
    return Response.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isControlPlaneEnabled()) {
    const disconnected = buildDisconnectedCentralAgentStatus();
    const serialized = serializeCentralAgentStatusDocument(disconnected);
    if (!serialized.ok) {
      return Response.json({ error: serialized.reason }, { status: 503 });
    }
    return new Response(serialized.body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const tasks = await listTasksForStatusImpl();
    const document = buildCentralAgentStatusFromTasks(tasks);
    const serialized = serializeCentralAgentStatusDocument(document);
    if (!serialized.ok) {
      return Response.json({ error: serialized.reason }, { status: 503 });
    }
    return new Response(serialized.body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const unavailable = buildDisconnectedCentralAgentStatus(
      "Engineering control-plane snapshot is unavailable.",
    );
    const failed = {
      ...unavailable,
      reportingStatus: "unavailable" as const,
    };
    const serialized = serializeCentralAgentStatusDocument(failed);
    if (!serialized.ok) {
      return Response.json({ error: serialized.reason }, { status: 503 });
    }
    return new Response(serialized.body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
}

export function centralAgentStatusMethodNotAllowed(): Response {
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
  );
}
