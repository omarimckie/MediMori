import { buildOwnerQueueProjection } from "./orchestration/projections";
import { validateExternalExecutionReferences } from "./orchestration/external-execution-refs";
import { isOwnerQueueManagementEnabled } from "./orchestration/flags";
import { resolveManagementOrchestrationQueuePort } from "./orchestration/queue-store-factory";
import type { OrchestrationQueuePort } from "./orchestration/orchestration-queue-port";
import {
  isCentralAgentManagerEnabled,
  isCentralAgentManagerOwner,
  isCentralAgentManagerOwnerConfigured,
} from "./owner-auth";
import { isProjectId } from "./registry";
import type { ProjectId } from "./types";

export type QueueManagementDeps = {
  isEnabled?: () => boolean;
  isOwnerConfigured?: () => boolean;
  getUsername?: () => Promise<string | null>;
  isOwner?: (username: string) => boolean;
  managementEnabled?: () => boolean;
  resolveStore?: () => Promise<OrchestrationQueuePort>;
};

async function listJobs(store: OrchestrationQueuePort) {
  return store.listJobs();
}

export async function centralAgentManagerQueueManagementResponse(
  request: Request,
  deps: QueueManagementDeps = {},
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const isEnabled = deps.isEnabled ?? isCentralAgentManagerEnabled;
  const isOwnerConfigured = deps.isOwnerConfigured ?? isCentralAgentManagerOwnerConfigured;
  const getUsername = deps.getUsername ?? (async () => null);
  const isOwner = deps.isOwner ?? isCentralAgentManagerOwner;
  const managementEnabled = deps.managementEnabled ?? isOwnerQueueManagementEnabled;
  const resolveStore = deps.resolveStore ?? resolveManagementOrchestrationQueuePort;

  if (!isEnabled() || !isOwnerConfigured()) {
    return Response.json({ error: "Central Agent Manager is disabled." }, { status: 503, headers });
  }
  const username = await getUsername();
  if (!username) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  if (!isOwner(username)) return Response.json({ error: "Forbidden." }, { status: 403, headers });
  if (!managementEnabled()) {
    return Response.json(
      {
        error:
          "Queue management is disabled. Set CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED=true and CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED=true.",
      },
      { status: 503, headers },
    );
  }

  let store: OrchestrationQueuePort;
  try {
    store = await resolveStore();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Durable queue transport unavailable.";
    return Response.json({ error: message }, { status: 503, headers });
  }

  const now = new Date().toISOString();

  if (request.method === "GET") {
    const jobs = await listJobs(store);
    const assignments = await store.listAssignments();
    const agents = await store.listAgents();
    const projection = buildOwnerQueueProjection({
      jobs,
      assignments,
      agents,
      now,
      simulation: false,
    });
    return Response.json({ ...projection, managementEnabled: true, durable: true }, { headers });
  }

  if (request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400, headers });
    }
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "enqueue") {
      const projectIdRaw = typeof body.projectId === "string" ? body.projectId : "";
      if (!isProjectId(projectIdRaw)) {
        return Response.json({ error: "Invalid project id." }, { status: 400, headers });
      }
      let externalRefs;
      if (body.externalRefs !== undefined && body.externalRefs !== null) {
        try {
          externalRefs = validateExternalExecutionReferences(body.externalRefs);
        } catch {
          return Response.json({ error: "Invalid externalRefs payload." }, { status: 400, headers });
        }
      }
      const job = await store.enqueueJob({
        id: String(body.id ?? ""),
        projectId: body.projectId as ProjectId,
        goalId: String(body.goalId ?? "goal"),
        description: String(body.description ?? ""),
        requestedOperation: typeof body.requestedOperation === "string" ? body.requestedOperation : null,
        provenance: { enqueuedBy: username, enqueuedAt: now, source: "owner" },
        ...(externalRefs ? { externalRefs } : {}),
        now,
      });
      return Response.json({ job }, { headers });
    }
    if (action === "cancel") {
      const job = await store.cancelJob(String(body.jobId ?? ""), now);
      return Response.json({ job }, { headers });
    }
    return Response.json({ error: "Unsupported action." }, { status: 400, headers });
  }

  return Response.json({ error: "Method not allowed." }, { status: 405, headers });
}
