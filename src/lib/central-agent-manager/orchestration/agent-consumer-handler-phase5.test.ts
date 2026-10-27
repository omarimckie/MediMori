import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  resetAgentBearerCacheForTests,
} from "./agent-consumer-auth";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import type { DurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import type { AgentConsumerBackend } from "./queue-store-factory";
import { createTestAgent, NOW } from "./test-fixtures";
import { isCursorBridgeEnabled } from "./flags";

const AGENT_A = "agent-phase5-a";
const TOKEN_A = "token-phase5-a-12345678";

function setBearerEnv() {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([{ agentId: AGENT_A, token: TOKEN_A }]);
  resetAgentBearerCacheForTests();
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function verifyTokenA(request: Request): string | null {
  return request.headers.get("authorization")?.includes(TOKEN_A) ? AGENT_A : null;
}

function durableConsumerBackend(durable: DurableOrchestrationQueueStore): AgentConsumerBackend {
  return {
    memory: durable.getMemoryStore(),
    queue: durable,
    reloadFromSql: () => durable.reloadFromSql(),
    claimNextAssignment: (agentId, now, options) => durable.claimNextAssignmentForAgent(agentId, now, options),
    heartbeatAssignment: (agentId, assignmentId, fenceToken, now, progress) =>
      durable.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
    persistAssignmentJobMutation: (assignmentId, fenceToken, allowedAssignmentStates) =>
      durable.persistAssignmentJobMutation(assignmentId, fenceToken, allowedAssignmentStates),
  };
}

const handlerDeps = (backend: AgentConsumerBackend) => ({
  isCamEnabled: () => true,
  isConsumerEnabled: () => true,
  isBearerConfigured: () => true,
  orchestrationResolvable: () => true,
  resolveBackend: async () => backend,
  now: () => NOW,
  verifyBearer: verifyTokenA,
});

async function seedMemoryReadyJob(store: MemoryOrchestrationQueueStore, jobId = "job-consumer-phase5") {
  store.registerAgentSync(createTestAgent({ id: AGENT_A }));
  const job = await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-p5",
    description: "phase5 consumer",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  assert.equal(job.state, "ready");
}

function memoryBackend(store: MemoryOrchestrationQueueStore): AgentConsumerBackend {
  return { memory: store, queue: store };
}

test("agent consumer GET lists active assignments for authenticated agent", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedMemoryReadyJob(store);
  const deps = handlerDeps(memoryBackend(store));
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: authHeaders(TOKEN_A),
      body: JSON.stringify({ action: "claim" }),
    }),
    deps,
  );
  assert.equal(claim.status, 200);
  const list = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", { method: "GET", headers: authHeaders(TOKEN_A) }),
    deps,
  );
  assert.equal(list.status, 200);
  const body = (await list.json()) as { assignments: { id: string }[] };
  assert.equal(body.assignments.length, 1);
});

test("agent consumer fail action marks assignment failed", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedMemoryReadyJob(store);
  const deps = handlerDeps(memoryBackend(store));
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: authHeaders(TOKEN_A),
      body: JSON.stringify({ action: "claim" }),
    }),
    deps,
  );
  const claimBody = (await claim.json()) as { assignment: { id: string; lease: { fenceToken: number } } };
  const fail = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: authHeaders(TOKEN_A),
      body: JSON.stringify({
        action: "fail",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        reason: "phase5-fail-smoke",
      }),
    }),
    deps,
  );
  assert.equal(fail.status, 200);
  const failBody = (await fail.json()) as { failed: boolean };
  assert.equal(failBody.failed, true);
});

test("agent consumer persists claim across durable store reconstruction", async () => {
  setBearerEnv();
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  durable.getMemoryStore().registerAgentSync(createTestAgent({ id: AGENT_A }));
  await durable.enqueueJob({
    id: "job-consumer-reload",
    projectId: "medimori",
    goalId: "g1",
    description: "reload",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  await durable.persistMutations();
  const backend1 = durableConsumerBackend(durable);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: authHeaders(TOKEN_A),
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(backend1),
  );
  assert.equal(claim.status, 200);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const list = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", { method: "GET", headers: authHeaders(TOKEN_A) }),
    handlerDeps(durableConsumerBackend(reloaded)),
  );
  const body = (await list.json()) as { assignments: unknown[] };
  assert.equal(body.assignments.length, 1);
});

test("cursor bridge flag defaults off during consumer handler tests", () => {
  delete process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED;
  assert.equal(isCursorBridgeEnabled(), false);
});
