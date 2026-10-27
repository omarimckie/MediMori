import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { CAM_AUDIT_JOB_DO_NOT_TOUCH, CAM_COMPLETED_STAGING_JOB_5B } from "./consumer-runtime-safety";
import { claimNextAssignmentForAgentSync } from "./agent-consumer-operations";
import { submitAssignmentEvidenceSync } from "./agent-consumer-operations";
import { validateAgentAssignmentCompletion } from "./agent-consumer-operations";
import { createTestAgent, NOW } from "./test-fixtures";
import type { AgentConsumerBackend } from "./queue-store-factory";

const AGENT = "agent-restart-5b";
const TOKEN = "token-agent-restart-5b-12345678";

function setBearerEnv() {
  process.env.CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON = JSON.stringify([
    { agentId: AGENT, token: TOKEN },
  ]);
}

function durableBackend(durable: Awaited<ReturnType<typeof createDurableOrchestrationQueueStore>>): AgentConsumerBackend {
  return {
    get memory() {
      return durable.getMemoryStore();
    },
    queue: durable,
    reloadFromSql: () => durable.reloadFromSql(),
    claimNextAssignment: (agentId, now, options) => durable.claimNextAssignmentForAgent(agentId, now, options),
    heartbeatAssignment: (agentId, assignmentId, fenceToken, now, progress) =>
      durable.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
    persistAssignmentJobMutation: (assignmentId, fenceToken, allowed) =>
      durable.persistAssignmentJobMutation(assignmentId, fenceToken, allowed),
  };
}

async function seedDurableJob(durable: Awaited<ReturnType<typeof createDurableOrchestrationQueueStore>>, jobId: string) {
  const memory = durable.getMemoryStore();
  memory.registerAgentSync(createTestAgent({ id: AGENT }));
  await durable.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-restart",
    description: "restart durability",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    externalRefs: { correlationKey: `restart-${jobId}` },
    now: NOW,
  });
  memory.refreshDependencyReadinessSync(NOW);
  await durable.persistMutations();
}

test("completed assignment survives durable reconstruction", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  await seedDurableJob(durable, "job-restart-complete");
  const claim = await durable.claimNextAssignmentForAgent(AGENT, NOW, { jobId: "job-restart-complete" });
  assert.ok(claim);
  const evidenceId = "ev-restart-complete";
  submitAssignmentEvidenceSync(durable.getMemoryStore(), AGENT, claim.id, claim.lease.fenceToken, NOW, {
    id: evidenceId,
    kind: "work_completed",
    artifactRef: "artifacts/restart.json",
  });
  await durable.persistAssignmentJobMutation(claim.id, claim.lease.fenceToken, ["active"]);
  const validated = validateAgentAssignmentCompletion(
    durable.getMemoryStore(),
    AGENT,
    claim.id,
    claim.lease.fenceToken,
    NOW,
    [evidenceId],
  );
  await durable.completeAssignment(claim.id, NOW, validated);
  await durable.persistMutations();
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.equal(reloaded.getMemoryStore().getJobSync("job-restart-complete")?.state, "completed");
  assert.equal(
    reloaded.getMemoryStore().listAssignmentsSync().find((row) => row.id === claim.id)?.state,
    "completed",
  );
});

test("active assignment lease survives reload and rejects stale fence", async () => {
  setBearerEnv();
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  await seedDurableJob(durable, "job-restart-active");
  const claim = await durable.claimNextAssignmentForAgent(AGENT, NOW);
  assert.ok(claim);
  const fence = claim.lease.fenceToken;
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const heartbeat = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "heartbeat",
        assignmentId: claim.id,
        leaseFenceToken: 99999,
      }),
    }),
    {
      resolveBackend: async () => durableBackend(reloaded),
      isCamEnabled: () => true,
      isConsumerEnabled: () => true,
      isBearerConfigured: () => true,
      verifyBearer: () => AGENT,
      orchestrationResolvable: () => true,
      now: () => NOW,
    },
  );
  assert.equal(heartbeat.status, 409);
  const active = reloaded.getMemoryStore().listAssignmentsSync().find((row) => row.id === claim.id);
  assert.equal(active?.lease.fenceToken, fence);
});

test("duplicate completion is rejected after terminal state", async () => {
  setBearerEnv();
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  await seedDurableJob(durable, "job-restart-dup");
  const claim = await durable.claimNextAssignmentForAgent(AGENT, NOW, { jobId: "job-restart-dup" });
  assert.ok(claim);
  const evidenceId = "ev-dup";
  submitAssignmentEvidenceSync(durable.getMemoryStore(), AGENT, claim.id, claim.lease.fenceToken, NOW, {
    id: evidenceId,
    kind: "work_completed",
    artifactRef: "artifacts/dup.json",
  });
  await durable.persistAssignmentJobMutation(claim.id, claim.lease.fenceToken, ["active"]);
  const validated = validateAgentAssignmentCompletion(
    durable.getMemoryStore(),
    AGENT,
    claim.id,
    claim.lease.fenceToken,
    NOW,
    [evidenceId],
  );
  await durable.completeAssignment(claim.id, NOW, validated);
  const again = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        evidenceIds: [evidenceId],
      }),
    }),
    {
      resolveBackend: async () => durableBackend(durable),
      isCamEnabled: () => true,
      isConsumerEnabled: () => true,
      isBearerConfigured: () => true,
      verifyBearer: () => AGENT,
      orchestrationResolvable: () => true,
      now: () => NOW,
    },
  );
  assert.equal(again.status, 200);
  assert.equal(durable.getMemoryStore().getJobSync("job-restart-dup")?.state, "completed");
  assert.equal(
    durable.getMemoryStore().listAssignmentsSync().filter((row) => row.state === "completed").length,
    1,
  );
});

test("protected staging jobs are excluded from claim planning", async () => {
  const memory = (await createDurableOrchestrationQueueStore(createInMemoryOrchestrationSqlPort())).getMemoryStore();
  memory.registerAgentSync(createTestAgent({ id: AGENT }));
  await memory.enqueueJob({
    id: CAM_AUDIT_JOB_DO_NOT_TOUCH,
    projectId: "medimori",
    goalId: "g",
    description: "audit",
    requiredCapabilities: [],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  await memory.enqueueJob({
    id: "job-eligible-restart",
    projectId: "medimori",
    goalId: "g",
    description: "eligible",
    requiredCapabilities: [],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  memory.refreshDependencyReadinessSync(NOW);
  assert.equal(claimNextAssignmentForAgentSync(memory, AGENT, NOW)?.jobId, "job-eligible-restart");
  const agentB = "agent-restart-5b-b";
  memory.registerAgentSync(createTestAgent({ id: agentB }));
  assert.throws(() => claimNextAssignmentForAgentSync(memory, agentB, NOW, { jobId: CAM_AUDIT_JOB_DO_NOT_TOUCH }));
  assert.throws(() => claimNextAssignmentForAgentSync(memory, agentB, NOW, { jobId: CAM_COMPLETED_STAGING_JOB_5B }));
});

test("reload without consumer action does not create assignments", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  await seedDurableJob(durable, "job-no-auto-claim");
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.equal(reloaded.getMemoryStore().listAssignmentsSync().length, 0);
  assert.equal(reloaded.getMemoryStore().getJobSync("job-no-auto-claim")?.state, "ready");
});
