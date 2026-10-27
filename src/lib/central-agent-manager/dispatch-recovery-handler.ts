import { SupervisorContractError } from "./supervisor/types";
import {
  listCursorDispatchRecoveryCandidates,
  ownerCancelCursorDispatchRecoverySync,
  ownerConfirmVerifiedCursorIdsSync,
  ownerFailCursorDispatchRecoverySync,
} from "./orchestration/cursor-dispatch-recovery-operations";
import { isCursorDispatchRecoveryEnabled } from "./orchestration/flags";
import type { DurableOrchestrationQueueStore } from "./orchestration/durable-orchestration-queue-store";
import { validateExternalExecutionReferences } from "./orchestration/external-execution-refs";
import { resolveManagementOrchestrationQueuePort } from "./orchestration/queue-store-factory";
import {
  isCentralAgentManagerEnabled,
  isCentralAgentManagerOwner,
  isCentralAgentManagerOwnerConfigured,
} from "./owner-auth";

export type DispatchRecoveryDeps = {
  isEnabled?: () => boolean;
  isOwnerConfigured?: () => boolean;
  getUsername?: () => Promise<string | null>;
  isOwner?: (username: string) => boolean;
  recoveryEnabled?: () => boolean;
  resolveStore?: () => Promise<
    | DurableOrchestrationQueueStore
    | import("./orchestration/memory-queue-store").MemoryOrchestrationQueueStore
  >;
  now?: () => string;
};

function isDurableRecoveryStore(
  store: unknown,
): store is DurableOrchestrationQueueStore {
  const candidate = store as DurableOrchestrationQueueStore;
  return (
    typeof candidate.reloadFromSql === "function" &&
    typeof candidate.getMemoryStore === "function" &&
    typeof candidate.persistAssignmentJobMutation === "function"
  );
}

async function persistRecoveryMutation(
  store: DurableOrchestrationQueueStore,
  assignmentId: string,
  fenceToken: number,
): Promise<void> {
  await store.persistAssignmentJobMutation(assignmentId, fenceToken, ["ambiguous", "active", "released"]);
}

function contractErrorResponse(error: unknown, headers: Record<string, string>): Response {
  if (error instanceof SupervisorContractError) {
    return Response.json({ error: error.message }, { status: 409, headers });
  }
  const message = error instanceof Error ? error.message : "Dispatch recovery request failed.";
  return Response.json({ error: message }, { status: 400, headers });
}

export async function centralAgentManagerDispatchRecoveryResponse(
  request: Request,
  deps: DispatchRecoveryDeps = {},
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const isEnabled = deps.isEnabled ?? isCentralAgentManagerEnabled;
  const isOwnerConfigured = deps.isOwnerConfigured ?? isCentralAgentManagerOwnerConfigured;
  const getUsername = deps.getUsername ?? (async () => null);
  const isOwner = deps.isOwner ?? isCentralAgentManagerOwner;
  const recoveryEnabled = deps.recoveryEnabled ?? isCursorDispatchRecoveryEnabled;
  const resolveStore =
    deps.resolveStore ??
    (async () =>
      (await resolveManagementOrchestrationQueuePort()) as
        | DurableOrchestrationQueueStore
        | import("./orchestration/memory-queue-store").MemoryOrchestrationQueueStore);
  const now = deps.now ?? (() => new Date().toISOString());

  if (!isEnabled() || !isOwnerConfigured()) {
    return Response.json({ error: "Central Agent Manager is disabled." }, { status: 503, headers });
  }
  const username = await getUsername();
  if (!username) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  if (!isOwner(username)) return Response.json({ error: "Forbidden." }, { status: 403, headers });
  if (!recoveryEnabled()) {
    return Response.json(
      {
        error:
          "Cursor dispatch recovery is disabled. Set CENTRAL_AGENT_MANAGER_CURSOR_DISPATCH_RECOVERY_ENABLED=true with durable queue management enabled.",
      },
      { status: 503, headers },
    );
  }

  let store:
    | DurableOrchestrationQueueStore
    | import("./orchestration/memory-queue-store").MemoryOrchestrationQueueStore;
  try {
    store = await resolveStore();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Durable queue transport unavailable.";
    return Response.json({ error: message }, { status: 503, headers });
  }

  const observedAt = now();

  function memoryView(): import("./orchestration/memory-queue-store").MemoryOrchestrationQueueStore {
    if (isDurableRecoveryStore(store)) return store.getMemoryStore();
    return store;
  }

  if (request.method === "GET") {
    if (isDurableRecoveryStore(store)) {
      await store.reloadFromSql();
    }
    const candidates = listCursorDispatchRecoveryCandidates(memoryView());
    return Response.json(
      {
        contractVersion: "central-agent-manager-cursor-dispatch-recovery/v1",
        generatedAt: observedAt,
        recoveryRequired: candidates,
      },
      { headers },
    );
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : "";
  const auditId =
    typeof body.auditId === "string" && body.auditId.trim()
      ? body.auditId.trim()
      : `recovery-audit-${Date.now()}`;

  try {
    if (isDurableRecoveryStore(store)) {
      await store.reloadFromSql();
    }
    const memory = memoryView();
    const fenceBefore = memory
      .listAssignmentsSync()
      .find((row) => row.id === assignmentId)?.lease.fenceToken;

    if (action === "confirm_verified_external_ids") {
      const externalRefs = validateExternalExecutionReferences(body.externalRefs);
      if (!externalRefs) {
        return Response.json({ error: "externalRefs are required." }, { status: 400, headers });
      }
      const result = ownerConfirmVerifiedCursorIdsSync(memory, {
        assignmentId,
        ownerUsername: username,
        externalRefs,
        auditId,
        now: observedAt,
      });
      if (isDurableRecoveryStore(store)) {
        await persistRecoveryMutation(store, result.assignment.id, result.assignment.lease.fenceToken);
      }
      return Response.json({ assignment: result.assignment, job: result.job }, { headers });
    }

    if (action === "fail_external_dispatch") {
      const reason = typeof body.reason === "string" ? body.reason : "";
      if (!reason.trim()) {
        return Response.json({ error: "reason is required." }, { status: 400, headers });
      }
      const result = ownerFailCursorDispatchRecoverySync(memory, {
        assignmentId,
        ownerUsername: username,
        reason,
        auditId,
        now: observedAt,
      });
      if (isDurableRecoveryStore(store) && fenceBefore !== undefined) {
        await persistRecoveryMutation(store, result.assignment.id, fenceBefore);
      }
      return Response.json({ assignment: result.assignment, job: result.job }, { headers });
    }

    if (action === "cancel_external_dispatch") {
      const reason = typeof body.reason === "string" ? body.reason : "";
      if (!reason.trim()) {
        return Response.json({ error: "reason is required." }, { status: 400, headers });
      }
      const result = ownerCancelCursorDispatchRecoverySync(memory, {
        assignmentId,
        ownerUsername: username,
        reason,
        auditId,
        now: observedAt,
      });
      if (isDurableRecoveryStore(store) && fenceBefore !== undefined) {
        await persistRecoveryMutation(store, result.assignment.id, fenceBefore);
      }
      return Response.json({ assignment: result.assignment, job: result.job }, { headers });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400, headers });
  } catch (error) {
    return contractErrorResponse(error, headers);
  }
}
