import {
  centralAgentManagerAgentConsumerResponse,
  type AgentConsumerHandlerDeps,
} from "../../agent-consumer-handler";
import type { MockSpecialistAssignmentView } from "../mock-specialist-agent";

export type CursorBridgeConsumerClientOptions = {
  agentId: string;
  bearerToken: string;
  handlerDeps: AgentConsumerHandlerDeps;
};

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export class CursorBridgeConsumerClient {
  readonly agentId: string;

  constructor(private readonly options: CursorBridgeConsumerClientOptions) {
    this.agentId = options.agentId;
  }

  private request(body: Record<string, unknown>): Request {
    return new Request("http://local/internal/central-agent-manager/assignments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async postAction(body: Record<string, unknown>): Promise<Response> {
    return centralAgentManagerAgentConsumerResponse(this.request(body), this.options.handlerDeps);
  }

  async claim(input?: { jobId?: string; idempotencyKey?: string }): Promise<{
    status: number;
    assignment: MockSpecialistAssignmentView | null;
    externalRefs?: { cursorAgentId?: string; cursorRunId?: string; correlationKey?: string };
  }> {
    const response = await this.postAction({
      action: "claim",
      ...(input?.jobId ? { jobId: input.jobId } : {}),
      ...(input?.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    const body = await parseJson<{
      assignment: {
        id: string;
        jobId: string;
        lease: { fenceToken: number };
        externalRefs?: { cursorAgentId?: string; cursorRunId?: string; correlationKey?: string };
      } | null;
    }>(response);
    if (!body.assignment) {
      return { status: response.status, assignment: null };
    }
    return {
      status: response.status,
      assignment: {
        id: body.assignment.id,
        jobId: body.assignment.jobId,
        leaseFenceToken: body.assignment.lease.fenceToken,
      },
      externalRefs: body.assignment.externalRefs,
    };
  }

  async beginExternalDispatch(
    assignment: MockSpecialistAssignmentView,
    dispatchOwnerId: string,
  ): Promise<number> {
    const response = await this.postAction({
      action: "begin_external_dispatch",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      dispatchOwnerId,
    });
    return response.status;
  }

  async markExternalDispatchOutcomeUnknown(assignment: MockSpecialistAssignmentView): Promise<number> {
    const response = await this.postAction({
      action: "mark_external_dispatch_outcome_unknown",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
    });
    return response.status;
  }

  async markExternalDispatchFailed(
    assignment: MockSpecialistAssignmentView,
    reason: string,
  ): Promise<number> {
    const response = await this.postAction({
      action: "mark_external_dispatch_failed",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      reason,
    });
    return response.status;
  }

  async escalateExternalDispatchRecovery(
    assignment: MockSpecialistAssignmentView,
    reason: string,
  ): Promise<number> {
    const response = await this.postAction({
      action: "escalate_external_dispatch_recovery",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      reason,
    });
    return response.status;
  }

  async correlateExternal(
    assignment: MockSpecialistAssignmentView,
    externalRefs: { cursorAgentId?: string; cursorRunId?: string },
  ): Promise<number> {
    const response = await this.postAction({
      action: "correlate_external",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      externalRefs,
    });
    return response.status;
  }

  async heartbeat(
    assignment: MockSpecialistAssignmentView,
    progress?: { diagnostic?: string; artifactRef?: string },
  ): Promise<number> {
    const response = await this.postAction({
      action: "heartbeat",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      ...(progress?.diagnostic ? { diagnostic: progress.diagnostic } : {}),
      ...(progress?.artifactRef ? { artifactRef: progress.artifactRef } : {}),
    });
    return response.status;
  }

  async submitEvidence(
    assignment: MockSpecialistAssignmentView,
    evidence: { id: string; kind: "work_completed" | "progress_note"; artifactRef?: string; diagnostic?: string },
  ): Promise<number> {
    const response = await this.postAction({
      action: "submit_evidence",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      evidence,
    });
    return response.status;
  }

  async complete(
    assignment: MockSpecialistAssignmentView,
    evidenceIds: readonly string[],
    idempotencyKey?: string,
  ): Promise<{ status: number; jobState?: string }> {
    const response = await this.postAction({
      action: "complete",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      evidenceIds,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    const body = await parseJson<{ jobState?: string }>(response);
    return { status: response.status, jobState: body.jobState };
  }

  async fail(
    assignment: MockSpecialistAssignmentView,
    reason: string,
    idempotencyKey?: string,
  ): Promise<number> {
    const response = await this.postAction({
      action: "fail",
      assignmentId: assignment.id,
      leaseFenceToken: assignment.leaseFenceToken,
      reason,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return response.status;
  }
}
