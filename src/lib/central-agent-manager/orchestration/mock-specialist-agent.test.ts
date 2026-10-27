import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { isAgentConsumerEnabled } from "./flags";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import {
  createMockSpecialistHarness,
  MockSpecialistConsumerClient,
  observeOwnerQueueFromStore,
  runMockSpecialistAssignmentLifecycle,
} from "./mock-specialist-agent";
import { createTestAgent, NOW } from "./test-fixtures";
import { serializeManagerJob } from "./contracts-v1";
import type { AgentConsumerBackend } from "./queue-store-factory";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const TOKEN_A = "token-agent-a-12345678";
const TOKEN_B = "token-agent-b-12345678";

async function seedJob(store: MemoryOrchestrationQueueStore, jobId = "job-mock-specialist") {
  store.registerAgentSync(createTestAgent({ id: AGENT_A }));
  store.registerAgentSync(createTestAgent({ id: AGENT_B }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-mock",
    description: "Mock specialist validation job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    externalRefs: { correlationKey: "mock-specialist-phase3" },
    now: NOW,
  });
}

test("agent consumer and orchestration consumer flags stay disabled by default", () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED;
  delete process.env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED;
  assert.equal(isAgentConsumerEnabled(), false);
  if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED;
  else process.env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED = previous;
});

test("mock specialist completes assignment lifecycle and CAM observes terminal state", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store);
  const { client } = createMockSpecialistHarness({
    store,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const result = await runMockSpecialistAssignmentLifecycle({
    store,
    client,
    now: NOW,
    evidenceId: "ev-mock-phase3-done",
  });
  assert.equal(result.jobState, "completed");
  assert.equal(result.evidenceIds.includes("ev-mock-phase3-done"), true);
  assert.equal(result.ownerProjection.completedMilestones.length, 1);
  assert.equal(result.ownerProjection.activeAssignments.length, 0);
  assert.equal(
    result.ownerProjection.completedMilestones[0]?.jobId,
    "job-mock-specialist",
  );
});

test("mock specialist rejects unauthorized bearer", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store);
  const { handlerDeps } = createMockSpecialistHarness({
    store,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const response = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token-12345678", "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps,
  );
  assert.equal(response.status, 401);
});

test("mock specialist rejects stale lease on completion", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-stale-mock");
  const { client } = createMockSpecialistHarness({
    store,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  const complete = await client.complete(
    { ...claim.assignment!, leaseFenceToken: claim.assignment!.leaseFenceToken + 99 },
    ["ev-missing"],
  );
  assert.equal(complete.status, 409);
});

test("mock specialist rejects completion without persisted work evidence", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-no-evidence-mock");
  const { client } = createMockSpecialistHarness({
    store,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  const complete = await client.complete(claim.assignment!, ["ev-never-submitted"]);
  assert.equal(complete.status, 409);
});

test("mock specialist duplicate completion is idempotent", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-dup-mock");
  const { client } = createMockSpecialistHarness({
    store,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  const evidenceId = "ev-mock-dup-complete";
  assert.equal(
    await client.submitEvidence(claim.assignment!, {
      id: evidenceId,
      kind: "work_completed",
      artifactRef: "artifacts/mock.json",
    }),
    200,
  );
  const first = await client.complete(claim.assignment!, [evidenceId], "complete-dup-key123456");
  const second = await client.complete(claim.assignment!, [evidenceId], "complete-dup-key123456");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.jobState, second.jobState);
});

test("mock specialist rejects cross-agent completion", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedJob(store, "job-cross-mock");
  const agentA = createMockSpecialistHarness({
    store,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const agentB = createMockSpecialistHarness({
    store,
    agentId: AGENT_B,
    bearerToken: TOKEN_B,
    now: () => NOW,
  });
  const claim = await agentA.client.claim();
  assert.ok(claim.assignment);
  const cross = await agentB.client.complete(claim.assignment!, ["ev-cross"]);
  assert.equal(cross.status, 409);
});

test("mock specialist durable reload keeps evidence verifiable through completion", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const memory = durable.getMemoryStore();
  await seedJob(memory, "job-reload-mock");
  memory.refreshDependencyReadinessSync(NOW);
  const readyJob = memory.getJobSync("job-reload-mock");
  assert.ok(readyJob);
  await sql.upsertJob({ id: readyJob.id, payload_json: serializeManagerJob(readyJob), updated_at: readyJob.updatedAt });
  for (const agent of memory.listAgentsSync()) {
    await sql.upsertAgent({
      id: agent.id,
      payload_json: JSON.stringify(agent),
      updated_at: agent.lastObservedAt ?? NOW,
    });
  }
  const backend: AgentConsumerBackend = {
    get memory() {
      return durable.getMemoryStore();
    },
    queue: durable,
    reloadFromSql: () => durable.reloadFromSql(),
    claimNextAssignment: (agentId, now, options) =>
      durable.claimNextAssignmentForAgent(agentId, now, options),
    heartbeatAssignment: (agentId, assignmentId, fenceToken, now, progress) =>
      durable.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
    persistAssignmentJobMutation: (assignmentId, fenceToken, allowed) =>
      durable.persistAssignmentJobMutation(assignmentId, fenceToken, allowed),
  };
  const { client } = createMockSpecialistHarness({
    store: memory,
    backend,
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    now: () => NOW,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  const evidenceId = "ev-mock-reload-done";
  assert.equal(
    await client.submitEvidence(claim.assignment!, {
      id: evidenceId,
      kind: "work_completed",
      artifactRef: "artifacts/reload.json",
    }),
    200,
  );
  await durable.reloadFromSql();
  const reloaded = durable.getMemoryStore();
  assert.equal(reloaded.evidenceStore.get(evidenceId)?.id, evidenceId);
  const reloadedClient = new MockSpecialistConsumerClient({
    agentId: AGENT_A,
    bearerToken: TOKEN_A,
    handlerDeps: createMockSpecialistHarness({
      store: reloaded,
      backend: {
        get memory() {
          return durable.getMemoryStore();
        },
        queue: durable,
        reloadFromSql: () => durable.reloadFromSql(),
        claimNextAssignment: (agentId, now, options) =>
          durable.claimNextAssignmentForAgent(agentId, now, options),
        heartbeatAssignment: (agentId, assignmentId, fenceToken, now, progress) =>
          durable.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
        persistAssignmentJobMutation: (assignmentId, fenceToken, allowed) =>
          durable.persistAssignmentJobMutation(assignmentId, fenceToken, allowed),
      },
      agentId: AGENT_A,
      bearerToken: TOKEN_A,
      now: () => NOW,
    }).handlerDeps,
  });
  const assignment = reloaded
    .listAssignmentsSync()
    .find((row) => row.id === claim.assignment!.id);
  assert.ok(assignment);
  const complete = await reloadedClient.complete(
    {
      id: assignment.id,
      jobId: assignment.jobId,
      leaseFenceToken: assignment.lease.fenceToken,
    },
    [evidenceId],
  );
  assert.equal(complete.status, 200);
  assert.equal(complete.jobState, "completed");
  await durable.reloadFromSql();
  const projection = observeOwnerQueueFromStore(durable.getMemoryStore(), NOW, true);
  assert.equal(projection.completedMilestones.some((row) => row.jobId === "job-reload-mock"), true);
});
