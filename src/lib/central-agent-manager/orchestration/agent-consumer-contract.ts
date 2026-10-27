import { assertIdentifier } from "../supervisor/types";
import { SupervisorContractError } from "../supervisor/types";
import { orchestrationEvidenceKinds, type OrchestrationEvidenceKind } from "./orchestration-evidence";

export const AGENT_CONSUMER_CONTRACT_V1 = "central-agent-manager-agent-consumer/v1" as const;

export const agentConsumerActions = [
  "claim",
  "heartbeat",
  "submit_evidence",
  "begin_external_dispatch",
  "correlate_external",
  "mark_external_dispatch_failed",
  "mark_external_dispatch_outcome_unknown",
  "escalate_external_dispatch_recovery",
  "complete",
  "fail",
] as const;

export type AgentConsumerAction = (typeof agentConsumerActions)[number];

const idempotencyPattern = /^[\w-]{8,80}$/;

export type ParsedAgentConsumerRequest =
  | { action: "claim"; jobId?: string; idempotencyKey?: string }
  | {
      action: "heartbeat";
      assignmentId: string;
      leaseFenceToken: number;
      diagnostic?: string | null;
      artifactRef?: string | null;
    }
  | {
      action: "submit_evidence";
      assignmentId: string;
      leaseFenceToken: number;
      evidence: {
        id: string;
        kind: OrchestrationEvidenceKind;
        artifactRef?: string | null;
        diagnostic?: string | null;
      };
    }
  | {
      action: "begin_external_dispatch";
      assignmentId: string;
      leaseFenceToken: number;
      dispatchOwnerId: string;
    }
  | {
      action: "mark_external_dispatch_failed";
      assignmentId: string;
      leaseFenceToken: number;
      reason: string;
    }
  | {
      action: "mark_external_dispatch_outcome_unknown";
      assignmentId: string;
      leaseFenceToken: number;
    }
  | {
      action: "escalate_external_dispatch_recovery";
      assignmentId: string;
      leaseFenceToken: number;
      reason: string;
    }
  | {
      action: "correlate_external";
      assignmentId: string;
      leaseFenceToken: number;
      externalRefs: Record<string, unknown>;
    }
  | {
      action: "complete";
      assignmentId: string;
      leaseFenceToken: number;
      evidenceIds: string[];
      idempotencyKey?: string;
    }
  | {
      action: "fail";
      assignmentId: string;
      leaseFenceToken: number;
      reason: string;
      idempotencyKey?: string;
    };

function readOptionalIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !idempotencyPattern.test(value)) {
    throw new SupervisorContractError("Idempotency key is invalid.");
  }
  return value;
}

function readFenceToken(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SupervisorContractError("Lease fence token is invalid.");
  }
  return value;
}

function readAssignmentId(value: unknown): string {
  if (typeof value !== "string") {
    throw new SupervisorContractError("Assignment id is required.");
  }
  assertIdentifier(value, "Assignment id");
  return value;
}

export function parseAgentConsumerBody(body: Record<string, unknown>): ParsedAgentConsumerRequest {
  const action = body.action;
  if (typeof action !== "string" || !agentConsumerActions.includes(action as AgentConsumerAction)) {
    throw new SupervisorContractError("Agent consumer action is invalid.");
  }

  if (action === "claim") {
    const jobId = body.jobId;
    if (jobId !== undefined && jobId !== null) {
      if (typeof jobId !== "string") throw new SupervisorContractError("Job id is invalid.");
      assertIdentifier(jobId, "Job id");
    }
    return {
      action: "claim",
      jobId: typeof jobId === "string" ? jobId : undefined,
      idempotencyKey: readOptionalIdempotencyKey(body.idempotencyKey),
    };
  }

  if (action === "heartbeat") {
    return {
      action: "heartbeat",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      diagnostic: typeof body.diagnostic === "string" ? body.diagnostic : undefined,
      artifactRef: typeof body.artifactRef === "string" ? body.artifactRef : undefined,
    };
  }

  if (action === "begin_external_dispatch") {
    const dispatchOwnerId = body.dispatchOwnerId;
    if (typeof dispatchOwnerId !== "string" || !/^[\w-]{8,80}$/.test(dispatchOwnerId)) {
      throw new SupervisorContractError("Dispatch owner id is invalid.");
    }
    return {
      action: "begin_external_dispatch",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      dispatchOwnerId,
    };
  }

  if (action === "mark_external_dispatch_failed") {
    const reason = body.reason;
    if (typeof reason !== "string" || !reason.trim()) {
      throw new SupervisorContractError("Dispatch failure reason is required.");
    }
    return {
      action: "mark_external_dispatch_failed",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      reason: reason.trim().slice(0, 240),
    };
  }

  if (action === "mark_external_dispatch_outcome_unknown") {
    return {
      action: "mark_external_dispatch_outcome_unknown",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
    };
  }

  if (action === "escalate_external_dispatch_recovery") {
    const reason = body.reason;
    if (typeof reason !== "string" || !reason.trim()) {
      throw new SupervisorContractError("Recovery reason is required.");
    }
    return {
      action: "escalate_external_dispatch_recovery",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      reason: reason.trim().slice(0, 240),
    };
  }

  if (action === "correlate_external") {
    const externalRefs = body.externalRefs;
    if (!externalRefs || typeof externalRefs !== "object" || Array.isArray(externalRefs)) {
      throw new SupervisorContractError("External correlation payload is required.");
    }
    return {
      action: "correlate_external",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      externalRefs: externalRefs as Record<string, unknown>,
    };
  }

  if (action === "submit_evidence") {
    const evidence = body.evidence;
    if (!evidence || typeof evidence !== "object") {
      throw new SupervisorContractError("Evidence payload is required.");
    }
    const id = (evidence as { id?: unknown }).id;
    const kind = (evidence as { kind?: unknown }).kind;
    if (typeof id !== "string") throw new SupervisorContractError("Evidence id is required.");
    assertIdentifier(id, "Evidence id");
    if (typeof kind !== "string" || !orchestrationEvidenceKinds.includes(kind as OrchestrationEvidenceKind)) {
      throw new SupervisorContractError("Evidence kind is invalid.");
    }
    return {
      action: "submit_evidence",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      evidence: {
        id,
        kind: kind as OrchestrationEvidenceKind,
        artifactRef:
          typeof (evidence as { artifactRef?: unknown }).artifactRef === "string"
            ? (evidence as { artifactRef: string }).artifactRef
            : undefined,
        diagnostic:
          typeof (evidence as { diagnostic?: unknown }).diagnostic === "string"
            ? (evidence as { diagnostic: string }).diagnostic
            : undefined,
      },
    };
  }

  if (action === "complete") {
    const evidenceIds = body.evidenceIds;
    if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 20) {
      throw new SupervisorContractError("Evidence id list is invalid.");
    }
    const ids: string[] = [];
    for (const row of evidenceIds) {
      if (typeof row !== "string") throw new SupervisorContractError("Evidence id list is invalid.");
      assertIdentifier(row, "Evidence id");
      ids.push(row);
    }
    return {
      action: "complete",
      assignmentId: readAssignmentId(body.assignmentId),
      leaseFenceToken: readFenceToken(body.leaseFenceToken),
      evidenceIds: ids,
      idempotencyKey: readOptionalIdempotencyKey(body.idempotencyKey),
    };
  }

  const reason = body.reason;
  if (typeof reason !== "string" || !reason.trim()) {
    throw new SupervisorContractError("Failure reason is required.");
  }
  return {
    action: "fail",
    assignmentId: readAssignmentId(body.assignmentId),
    leaseFenceToken: readFenceToken(body.leaseFenceToken),
    reason: reason.trim().slice(0, 240),
    idempotencyKey: readOptionalIdempotencyKey(body.idempotencyKey),
  };
}
