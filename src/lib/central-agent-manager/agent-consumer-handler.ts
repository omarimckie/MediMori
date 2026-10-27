import { isCentralAgentManagerEnabled } from "./owner-auth";
import {
  AGENT_CONSUMER_CONTRACT_V1,
  parseAgentConsumerBody,
} from "./orchestration/agent-consumer-contract";
import {
  isAgentConsumerBearerConfigured,
  verifyAgentConsumerBearer,
} from "./orchestration/agent-consumer-auth";
import {
  claimNextAssignmentForAgentSync,
  validateAgentAssignmentCompletion,
  validateAgentAssignmentFailure,
  heartbeatAssignmentSync,
  listActiveAssignmentsForAgentSync,
  submitAssignmentEvidenceSync,
  correlateAssignmentExternalRefsSync,
  beginExternalDispatchSync,
  markExternalDispatchFailedSync,
  markExternalDispatchOutcomeUnknownSync,
} from "./orchestration/agent-consumer-operations";
import { requireDispatchRecoverySync } from "./orchestration/cursor-dispatch-intent";
import { isAgentConsumerEnabled, isAgentConsumerOrchestrationResolvable } from "./orchestration/flags";
import { resolveAgentConsumerBackend, type AgentConsumerBackend } from "./orchestration/queue-store-factory";
import { SupervisorContractError } from "./supervisor/types";
import type { ManagerAssignmentRecord } from "./orchestration/contracts-v1";

export type AgentConsumerHandlerDeps = {
  isCamEnabled?: () => boolean;
  isConsumerEnabled?: () => boolean;
  isBearerConfigured?: () => boolean;
  verifyBearer?: (request: Request) => string | null;
  orchestrationResolvable?: () => boolean;
  resolveBackend?: () => Promise<AgentConsumerBackend>;
  now?: () => string;
};

function serializeAssignment(assignment: ManagerAssignmentRecord) {
  return {
    id: assignment.id,
    jobId: assignment.jobId,
    projectId: assignment.projectId,
    state: assignment.state,
    lease: assignment.lease,
    ...(assignment.externalRefs ? { externalRefs: assignment.externalRefs } : {}),
    ...(assignment.cursorDispatchIntent ? { cursorDispatchIntent: assignment.cursorDispatchIntent } : {}),
  };
}

function idempotencyStorageKey(agentId: string, key: string): string {
  return `${agentId}:${key}`;
}

async function reloadConsumerState(backend: AgentConsumerBackend): Promise<void> {
  await backend.reloadFromSql?.();
}

async function persistConsumerAssignmentMutation(
  backend: AgentConsumerBackend,
  assignment: ManagerAssignmentRecord,
  allowedAssignmentStates?: readonly string[],
): Promise<void> {
  if (backend.persistAssignmentJobMutation) {
    await backend.persistAssignmentJobMutation(
      assignment.id,
      assignment.lease.fenceToken,
      allowedAssignmentStates,
    );
    return;
  }
  await backend.afterMutation?.();
}

function contractErrorResponse(error: unknown, headers: Record<string, string>): Response {
  if (error instanceof SupervisorContractError) {
    return Response.json({ error: error.message }, { status: 409, headers });
  }
  const message = error instanceof Error ? error.message : "Agent consumer request failed.";
  return Response.json({ error: message }, { status: 400, headers });
}

export async function centralAgentManagerAgentConsumerResponse(
  request: Request,
  deps: AgentConsumerHandlerDeps = {},
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const isCamEnabled = deps.isCamEnabled ?? isCentralAgentManagerEnabled;
  const isConsumerEnabled = deps.isConsumerEnabled ?? isAgentConsumerEnabled;
  const isBearerConfigured = deps.isBearerConfigured ?? isAgentConsumerBearerConfigured;
  const verifyBearer = deps.verifyBearer ?? verifyAgentConsumerBearer;
  const orchestrationResolvable = deps.orchestrationResolvable ?? isAgentConsumerOrchestrationResolvable;
  const resolveBackend = deps.resolveBackend ?? (() => resolveAgentConsumerBackend());
  const now = deps.now ?? (() => new Date().toISOString());

  if (!isCamEnabled() || !isConsumerEnabled()) {
    return Response.json({ error: "Agent consumer interface is disabled." }, { status: 503, headers });
  }
  if (!isBearerConfigured()) {
    return Response.json({ error: "Agent consumer bearer credentials are not configured." }, { status: 503, headers });
  }
  const agentId = verifyBearer(request);
  if (!agentId) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  if (!orchestrationResolvable()) {
    return Response.json(
      {
        error:
          "Orchestration queue is unavailable. Enable CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED and queue management or durable access.",
      },
      { status: 503, headers },
    );
  }

  let backend: AgentConsumerBackend;
  try {
    backend = await resolveBackend();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orchestration transport unavailable.";
    return Response.json({ error: message }, { status: 503, headers });
  }

  const observedAt = now();

  if (request.method === "GET") {
    const assignments = listActiveAssignmentsForAgentSync(backend.memory, agentId);
    return Response.json(
      {
        contractVersion: AGENT_CONSUMER_CONTRACT_V1,
        agentId,
        assignments: assignments.map(serializeAssignment),
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
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers });
  }

  try {
    const parsed = parseAgentConsumerBody(body);

    if (parsed.action === "claim") {
      if (parsed.idempotencyKey) {
        const stored = backend.memory.getConsumerIdempotencyRecord(
          idempotencyStorageKey(agentId, parsed.idempotencyKey),
        );
        if (stored?.action === "claim") {
          return Response.json(stored.body, { headers });
        }
      }
      const assignment = backend.claimNextAssignment
        ? await backend.claimNextAssignment(agentId, observedAt, { jobId: parsed.jobId })
        : claimNextAssignmentForAgentSync(backend.memory, agentId, observedAt, {
            jobId: parsed.jobId,
          });
      const payload = {
        contractVersion: AGENT_CONSUMER_CONTRACT_V1,
        agentId,
        assignment: assignment ? serializeAssignment(assignment) : null,
      };
      if (parsed.idempotencyKey) {
        backend.memory.setConsumerIdempotencyRecord(
          idempotencyStorageKey(agentId, parsed.idempotencyKey),
          "claim",
          payload,
        );
      }
      return Response.json(payload, { headers });
    }

    if (parsed.action === "heartbeat") {
      const assignment = backend.heartbeatAssignment
        ? await backend.heartbeatAssignment(
            agentId,
            parsed.assignmentId,
            parsed.leaseFenceToken,
            observedAt,
            { diagnostic: parsed.diagnostic, artifactRef: parsed.artifactRef },
          )
        : heartbeatAssignmentSync(
            backend.memory,
            agentId,
            parsed.assignmentId,
            parsed.leaseFenceToken,
            observedAt,
            { diagnostic: parsed.diagnostic, artifactRef: parsed.artifactRef },
          );
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          assignment: serializeAssignment(assignment),
        },
        { headers },
      );
    }

    if (parsed.action === "submit_evidence") {
      await reloadConsumerState(backend);
      submitAssignmentEvidenceSync(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
        parsed.evidence,
      );
      const assignment = backend.memory
        .listAssignmentsSync()
        .find((row) => row.id === parsed.assignmentId);
      if (assignment) {
        await persistConsumerAssignmentMutation(backend, assignment, ["active"]);
      }
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          evidenceId: parsed.evidence.id,
        },
        { headers },
      );
    }

    if (parsed.action === "begin_external_dispatch") {
      await reloadConsumerState(backend);
      const assignment = beginExternalDispatchSync(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
        parsed.dispatchOwnerId,
      );
      await persistConsumerAssignmentMutation(backend, assignment, ["active"]);
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          assignment: serializeAssignment(assignment),
        },
        { headers },
      );
    }

    if (parsed.action === "mark_external_dispatch_failed") {
      await reloadConsumerState(backend);
      const assignment = markExternalDispatchFailedSync(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
        parsed.reason,
      );
      await persistConsumerAssignmentMutation(backend, assignment, ["active"]);
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          assignment: serializeAssignment(assignment),
        },
        { headers },
      );
    }

    if (parsed.action === "mark_external_dispatch_outcome_unknown") {
      await reloadConsumerState(backend);
      const assignment = markExternalDispatchOutcomeUnknownSync(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
      );
      await persistConsumerAssignmentMutation(backend, assignment, ["active"]);
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          assignment: serializeAssignment(assignment),
        },
        { headers },
      );
    }

    if (parsed.action === "escalate_external_dispatch_recovery") {
      await reloadConsumerState(backend);
      const assignment = requireDispatchRecoverySync(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
        parsed.reason,
      );
      await persistConsumerAssignmentMutation(backend, assignment, ["active"]);
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          assignment: serializeAssignment(assignment),
        },
        { headers },
      );
    }

    if (parsed.action === "correlate_external") {
      await reloadConsumerState(backend);
      const assignment = correlateAssignmentExternalRefsSync(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
        parsed.externalRefs,
      );
      await persistConsumerAssignmentMutation(backend, assignment, ["active"]);
      return Response.json(
        {
          contractVersion: AGENT_CONSUMER_CONTRACT_V1,
          agentId,
          assignment: serializeAssignment(assignment),
        },
        { headers },
      );
    }

    if (parsed.action === "complete") {
      if (parsed.idempotencyKey) {
        const stored = backend.memory.getConsumerIdempotencyRecord(
          idempotencyStorageKey(agentId, parsed.idempotencyKey),
        );
        if (stored?.action === "complete") {
          return Response.json(stored.body, { headers });
        }
      }
      await reloadConsumerState(backend);
      const assignmentBefore = backend.memory
        .listAssignmentsSync()
        .find((row) => row.id === parsed.assignmentId);
      const jobIdBefore = assignmentBefore?.jobId ?? "";
      const validatedEvidence = validateAgentAssignmentCompletion(
        backend.memory,
        agentId,
        parsed.assignmentId,
        parsed.leaseFenceToken,
        observedAt,
        parsed.evidenceIds,
      );
      await backend.queue.completeAssignment(parsed.assignmentId, observedAt, validatedEvidence);
      const job = await backend.memory.getJob(jobIdBefore);
      const payload = {
        contractVersion: AGENT_CONSUMER_CONTRACT_V1,
        agentId,
        assignmentId: parsed.assignmentId,
        jobState: job?.state ?? "unknown",
        evidenceIds: parsed.evidenceIds,
        ...(job?.externalRefs ? { externalRefs: job.externalRefs } : {}),
      };
      if (parsed.idempotencyKey) {
        backend.memory.setConsumerIdempotencyRecord(
          idempotencyStorageKey(agentId, parsed.idempotencyKey),
          "complete",
          payload,
        );
      }
      return Response.json(payload, { headers });
    }

    if (parsed.idempotencyKey) {
      const stored = backend.memory.getConsumerIdempotencyRecord(
        idempotencyStorageKey(agentId, parsed.idempotencyKey),
      );
      if (stored?.action === "fail") {
        return Response.json(stored.body, { headers });
      }
    }
    await reloadConsumerState(backend);
    validateAgentAssignmentFailure(
      backend.memory,
      agentId,
      parsed.assignmentId,
      parsed.leaseFenceToken,
      observedAt,
    );
    await backend.queue.failAssignmentOutcome(parsed.assignmentId, observedAt, parsed.reason);
    const payload = {
      contractVersion: AGENT_CONSUMER_CONTRACT_V1,
      agentId,
      assignmentId: parsed.assignmentId,
      failed: true,
      reason: parsed.reason,
    };
    if (parsed.idempotencyKey) {
      backend.memory.setConsumerIdempotencyRecord(
        idempotencyStorageKey(agentId, parsed.idempotencyKey),
        "fail",
        payload,
      );
    }
    return Response.json(payload, { headers });
  } catch (error) {
    return contractErrorResponse(error, headers);
  }
}
