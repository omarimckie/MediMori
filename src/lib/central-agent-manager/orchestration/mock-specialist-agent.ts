import {
  centralAgentManagerAgentConsumerResponse,
  type AgentConsumerHandlerDeps,
} from "../agent-consumer-handler";
import type { ManagerJobRecord } from "./contracts-v1";
import type { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { buildOwnerQueueProjection, type OwnerQueueProjection } from "./projections";
import type { AgentConsumerBackend } from "./queue-store-factory";

export const MOCK_SPECIALIST_CONTRACT_V1 = "central-agent-manager-mock-specialist/v1" as const;

export type MockSpecialistConsumerClientOptions = {
  agentId: string;
  bearerToken: string;
  handlerDeps: AgentConsumerHandlerDeps;
};

export type MockSpecialistAssignmentView = {
  id: string;
  jobId: string;
  leaseFenceToken: number;
};

export type MockSpecialistRunResult = {
  contractVersion: typeof MOCK_SPECIALIST_CONTRACT_V1;
  agentId: string;
  assignmentId: string;
  jobId: string;
  evidenceIds: readonly string[];
  jobState: ManagerJobRecord["state"];
  ownerProjection: OwnerQueueProjection;
};

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export class MockSpecialistConsumerClient {
  readonly agentId: string;
  constructor(private readonly options: MockSpecialistConsumerClientOptions) {
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
  }> {
    const response = await this.postAction({
      action: "claim",
      ...(input?.jobId ? { jobId: input.jobId } : {}),
      ...(input?.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    const body = await parseJson<{
      assignment: { id: string; jobId: string; lease: { fenceToken: number } } | null;
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
    };
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
}

export function observeOwnerQueueFromStore(
  store: MemoryOrchestrationQueueStore,
  now: string,
  simulation = true,
): OwnerQueueProjection {
  return buildOwnerQueueProjection({
    jobs: store.listJobsSync(),
    assignments: store.listAssignmentsSync(),
    agents: store.listAgentsSync(),
    now,
    simulation,
  });
}

/**
 * Simulated specialist execution through the Phase 2 agent consumer API only.
 * Does not invoke engineering workers, Cursor SDK, or owner/admin routes.
 */
export async function runMockSpecialistAssignmentLifecycle(input: {
  store: MemoryOrchestrationQueueStore;
  client: MockSpecialistConsumerClient;
  now: string;
  evidenceId?: string;
  progressDiagnostic?: string;
}): Promise<MockSpecialistRunResult> {
  const resolvedEvidenceId = input.evidenceId ?? `ev-mock-work-${Date.parse(input.now)}`;

  const claim = await input.client.claim();
  if (claim.status !== 200 || !claim.assignment) {
    throw new Error(`Mock specialist could not claim an assignment (status ${claim.status}).`);
  }
  const assignment = claim.assignment;

  const heartbeatStatus = await input.client.heartbeat(assignment, {
    diagnostic: input.progressDiagnostic ?? "Mock specialist progress note.",
  });
  if (heartbeatStatus !== 200) {
    throw new Error(`Mock specialist heartbeat failed with status ${heartbeatStatus}.`);
  }

  const progressStatus = await input.client.submitEvidence(assignment, {
    id: `ev-mock-progress-${assignment.id}`,
    kind: "progress_note",
    diagnostic: "Bounded mock specialist progress.",
  });
  if (progressStatus !== 200) {
    throw new Error(`Mock specialist progress evidence failed with status ${progressStatus}.`);
  }

  const workStatus = await input.client.submitEvidence(assignment, {
    id: resolvedEvidenceId,
    kind: "work_completed",
    artifactRef: "artifacts/mock-specialist/outcome.json",
  });
  if (workStatus !== 200) {
    throw new Error(`Mock specialist work evidence failed with status ${workStatus}.`);
  }

  const complete = await input.client.complete(assignment, [resolvedEvidenceId]);
  if (complete.status !== 200 || complete.jobState !== "completed") {
    throw new Error(
      `Mock specialist completion failed (status ${complete.status}, jobState ${complete.jobState ?? "unknown"}).`,
    );
  }

  const job = input.store.getJobSync(assignment.jobId);
  if (!job || job.state !== "completed") {
    throw new Error("CAM job did not reach completed terminal state after mock specialist run.");
  }

  const ownerProjection = observeOwnerQueueFromStore(input.store, input.now, true);
  const milestone = ownerProjection.completedMilestones.find((row) => row.jobId === assignment.jobId);
  if (!milestone || !milestone.evidenceIds.includes(resolvedEvidenceId)) {
    throw new Error("Owner projection does not show verified completion milestone.");
  }

  return {
    contractVersion: MOCK_SPECIALIST_CONTRACT_V1,
    agentId: input.client.agentId,
    assignmentId: assignment.id,
    jobId: assignment.jobId,
    evidenceIds: milestone.evidenceIds,
    jobState: job.state,
    ownerProjection,
  };
}

/** Test harness helper: build handler deps wired to a single in-memory backend. */
export function createMockSpecialistHarness(input: {
  store: MemoryOrchestrationQueueStore;
  backend?: AgentConsumerBackend;
  agentId: string;
  bearerToken: string;
  now: () => string;
  verifyBearer?: (request: Request) => string | null;
}): { backend: AgentConsumerBackend; handlerDeps: AgentConsumerHandlerDeps; client: MockSpecialistConsumerClient } {
  const backend = input.backend ?? { memory: input.store, queue: input.store };
  const handlerDeps: AgentConsumerHandlerDeps = {
    isCamEnabled: () => true,
    isConsumerEnabled: () => true,
    isBearerConfigured: () => true,
    orchestrationResolvable: () => true,
    resolveBackend: async () => backend,
    now: input.now,
    verifyBearer:
      input.verifyBearer ??
      ((request) => {
        const header = request.headers.get("authorization") ?? "";
        return header.includes(input.bearerToken) ? input.agentId : null;
      }),
  };
  const client = new MockSpecialistConsumerClient({
    agentId: input.agentId,
    bearerToken: input.bearerToken,
    handlerDeps,
  });
  return { backend, handlerDeps, client };
}
