import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { baseJobFixture, createTestAgent, NOW } from "./test-fixtures";
import { serializeManagerJob } from "./contracts-v1";
import type { AgentConsumerBackend } from "./queue-store-factory";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  resetAgentBearerCacheForTests,
} from "./agent-consumer-auth";

const AGENT_A = "agent-a";
const TOKEN_A = "token-agent-a-12345678";

function handlerDeps(backend: AgentConsumerBackend) {
  return {
    isCamEnabled: () => true,
    isConsumerEnabled: () => true,
    isBearerConfigured: () => true,
    orchestrationResolvable: () => true,
    resolveBackend: async () => backend,
    now: () => NOW,
    verifyBearer: (request: Request) =>
      request.headers.get("authorization")?.includes(TOKEN_A) ? AGENT_A : null,
  };
}

async function seedAgentJob(store: MemoryOrchestrationQueueStore, jobId = "job-evidence-durable") {
  store.registerAgentSync(createTestAgent({ id: AGENT_A }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal",
    description: "evidence durable",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
}

test("durable evidence survives reload and supports completion", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();

  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const memory = durable.getMemoryStore();
  await seedAgentJob(memory);
  await durable.persistMutations();

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
  const deps = handlerDeps(backend);

  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    deps,
  );
  const claimBody = (await claim.json()) as { assignment: { id: string; lease: { fenceToken: number } } };
  const assignmentId = claimBody.assignment.id;
  const fence = claimBody.assignment.lease.fenceToken;

  const evidence = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "submit_evidence",
        assignmentId,
        leaseFenceToken: fence,
        evidence: { id: "ev-durable-1", kind: "work_completed", artifactRef: "artifacts/out.json" },
      }),
    }),
    deps,
  );
  assert.equal(evidence.status, 200);

  await durable.reloadFromSql();
  const reloadedMemory = durable.getMemoryStore();
  assert.equal(reloadedMemory.evidenceStore.get("ev-durable-1")?.id, "ev-durable-1");

  const reloadedBackend: AgentConsumerBackend = {
    memory: reloadedMemory,
    queue: durable,
    reloadFromSql: () => durable.reloadFromSql(),
    claimNextAssignment: (agentId, now, options) =>
      durable.claimNextAssignmentForAgent(agentId, now, options),
    heartbeatAssignment: (agentId, assignmentId, fenceToken, now, progress) =>
      durable.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
    persistAssignmentJobMutation: (assignmentId, fenceToken, allowed) =>
      durable.persistAssignmentJobMutation(assignmentId, fenceToken, allowed),
  };
  const complete = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        assignmentId,
        leaseFenceToken: fence,
        evidenceIds: ["ev-durable-1"],
      }),
    }),
    handlerDeps(reloadedBackend),
  );
  assert.equal(complete.status, 200);
});

test("reload blocks completed jobs that reference missing durable evidence", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const job = baseJobFixture({
    id: "job-bad-evidence",
    state: "completed",
    evidenceIds: ["ev-missing"],
    terminalOutcome: "succeeded",
  });
  await sql.upsertJob({
    id: job.id,
    payload_json: serializeManagerJob(job),
    updated_at: NOW,
  });
  await sql.upsertAssignment({
    id: "asgn-bad-evidence",
    job_id: "job-bad-evidence",
    payload_json: JSON.stringify({
      contractVersion: "central-agent-orchestration-assignment/v1",
      id: "asgn-bad-evidence",
      jobId: "job-bad-evidence",
      projectId: "medimori",
      agentId: AGENT_A,
      state: "completed",
      lease: {
        holderAgentId: AGENT_A,
        leasedAt: NOW,
        expiresAt: NOW,
        dispatchAttempt: 1,
        fenceToken: 1,
      },
      createdAt: NOW,
      updatedAt: NOW,
    }),
    updated_at: NOW,
  });

  const durable = await createDurableOrchestrationQueueStore(sql);
  const reloaded = durable.getMemoryStore().getJobSync("job-bad-evidence");
  assert.equal(reloaded?.state, "blocked");
  assert.match(reloaded?.blockReason ?? "", /not durably verifiable/i);
});

test("agent consumer responses never echo bearer secrets", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();

  const store = new MemoryOrchestrationQueueStore();
  await seedAgentJob(store);
  const backend: AgentConsumerBackend = { memory: store, queue: store };
  const responses = await Promise.all([
    centralAgentManagerAgentConsumerResponse(new Request("http://local/assignments"), handlerDeps(backend)),
    centralAgentManagerAgentConsumerResponse(
      new Request("http://local/assignments", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      }),
      handlerDeps(backend),
    ),
    centralAgentManagerAgentConsumerResponse(
      new Request("http://local/assignments", {
        method: "POST",
        headers: { authorization: `Bearer wrong`, "content-type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      }),
      handlerDeps(backend),
    ),
  ]);
  for (const response of responses) {
    const body = await response.text();
    assert.doesNotMatch(body, /token-agent-a-12345678/);
    assert.doesNotMatch(body, /CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON/);
  }
});
