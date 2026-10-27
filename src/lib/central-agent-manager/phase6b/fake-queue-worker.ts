import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import { createMockSpecialistHarness, MockSpecialistConsumerClient } from "../orchestration/mock-specialist-agent";
import type { WorkerOutcome } from "../phase6a/closed-loop-manager";
import { agentIdForRole } from "./queue-agent-registry";
import { encodeCam6bFailureOutcome } from "./queue-outcome-ingestion";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";

export type FakeWorkerScriptEntry =
  | { mode: "complete"; evidenceId?: string }
  | { mode: "fail"; outcome: WorkerOutcome };

export type FakeWorkerScript = {
  byTaskId: Record<string, FakeWorkerScriptEntry[]>;
};

export function createPhase6bMockClients(input: {
  store: MemoryOrchestrationQueueStore;
  now: () => string;
  bearerByRole: Record<SpecialistTemplateRole, string>;
}): Map<SpecialistTemplateRole, MockSpecialistConsumerClient> {
  const clients = new Map<SpecialistTemplateRole, MockSpecialistConsumerClient>();
  const roles: SpecialistTemplateRole[] = [
    "research_planning",
    "engineering",
    "qa_independent_review",
    "devops",
  ];
  for (const role of roles) {
    const token = input.bearerByRole[role];
    const { client } = createMockSpecialistHarness({
      store: input.store,
      agentId: agentIdForRole(role),
      bearerToken: token,
      now: input.now,
    });
    clients.set(role, client);
  }
  return clients;
}

const taskAttemptCounters = new Map<string, number>();

function nextScriptEntry(script: FakeWorkerScript, taskId: string): FakeWorkerScriptEntry {
  const queue = script.byTaskId[taskId] ?? [{ mode: "complete" }];
  const index = taskAttemptCounters.get(taskId) ?? 0;
  taskAttemptCounters.set(taskId, index + 1);
  return queue[Math.min(index, queue.length - 1)];
}

export async function runFakeWorkerForActiveAssignment(input: {
  store: MemoryOrchestrationQueueStore;
  client: MockSpecialistConsumerClient;
  role: SpecialistTemplateRole;
  taskId: string;
  jobId: string;
  script: FakeWorkerScript;
  now: string;
}): Promise<{ ran: boolean; jobId?: string }> {
  const entry = nextScriptEntry(input.script, input.taskId);

  if (entry.mode === "complete") {
    const claim = await input.client.claim({ jobId: input.jobId });
    if (claim.status !== 200 || !claim.assignment) {
      return { ran: false };
    }
    await input.client.heartbeat(claim.assignment, { diagnostic: "Fake worker executing." });
    const evidenceId = entry.evidenceId ?? `ev-${input.taskId}-${input.jobId}`;
    await input.client.submitEvidence(claim.assignment, {
      id: `ev-progress-${claim.assignment.id}`,
      kind: "progress_note",
      diagnostic: "Progress",
    });
    await input.client.submitEvidence(claim.assignment, {
      id: evidenceId,
      kind: "work_completed",
      artifactRef: "artifacts/mock/outcome.json",
    });
    const complete = await input.client.complete(claim.assignment, [evidenceId]);
    if (complete.status !== 200 || complete.jobState !== "completed") {
      throw new Error(`Fake worker completion failed for ${input.jobId}.`);
    }
    return { ran: true, jobId: input.jobId };
  }

  const claim = await input.client.claim({ jobId: input.jobId });
  if (claim.status !== 200 || !claim.assignment) {
    return { ran: false };
  }
  await input.client.heartbeat(claim.assignment, { diagnostic: "Simulated failure path." });
  const failResponse = await input.client.postAction({
    action: "fail",
    assignmentId: claim.assignment.id,
    leaseFenceToken: claim.assignment.leaseFenceToken,
    reason: encodeCam6bFailureOutcome(entry.outcome),
  });
  if (failResponse.status !== 200) {
    throw new Error(`Fake worker fail action returned ${failResponse.status}.`);
  }
  return { ran: true, jobId: claim.assignment.jobId };
}

export function resetFakeWorkerScriptCounters(): void {
  taskAttemptCounters.clear();
}
