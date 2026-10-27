import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import { claimNextAssignmentForAgentSync } from "./agent-consumer-operations";
import { CAM_AUDIT_JOB_DO_NOT_TOUCH } from "./consumer-runtime-safety";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { createTestAgent, NOW } from "./test-fixtures";

const AGENT = "agent-phase5b";

async function seedJob(store: MemoryOrchestrationQueueStore, jobId: string) {
  store.registerAgentSync(createTestAgent({ id: AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-p5b",
    description: "phase5b",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
}

test("consumer cannot claim protected Phase 5a audit job", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, CAM_AUDIT_JOB_DO_NOT_TOUCH);
  await seedJob(store, "job-phase5b-consumer-target");
  const claim = claimNextAssignmentForAgentSync(store, AGENT, NOW);
  assert.ok(claim);
  assert.notEqual(claim.jobId, CAM_AUDIT_JOB_DO_NOT_TOUCH);
});

test("consumer heartbeat rejects unknown assignment id", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: {
        authorization: "Bearer token-agent-a-12345678",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "heartbeat",
        assignmentId: "asgn-does-not-exist",
        leaseFenceToken: 1,
      }),
    }),
    {
      isCamEnabled: () => true,
      isConsumerEnabled: () => true,
      isBearerConfigured: () => true,
      orchestrationResolvable: () => true,
      resolveBackend: async () => ({ memory: store, queue: store }),
      verifyBearer: () => "agent-a",
    },
  );
  assert.equal(response.status, 409);
});

test("explicit claim of audit job id is rejected at planning layer", () => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: AGENT }));
  assert.throws(
    () => claimNextAssignmentForAgentSync(store, AGENT, NOW, { jobId: CAM_AUDIT_JOB_DO_NOT_TOUCH }),
    /must not mutate/,
  );
});
