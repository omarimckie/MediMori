import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "./agent-consumer-handler";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  resetAgentBearerCacheForTests,
} from "./orchestration/agent-consumer-auth";
import { claimNextAssignmentForAgentSync } from "./orchestration/agent-consumer-operations";
import { MemoryOrchestrationQueueStore } from "./orchestration/memory-queue-store";
import { createTestAgent, NOW } from "./orchestration/test-fixtures";
import type { AgentConsumerBackend } from "./orchestration/queue-store-factory";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const TOKEN_A = "token-agent-a-12345678";
const TOKEN_B = "token-agent-b-12345678";

function setBearerEnv() {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
    { agentId: AGENT_B, token: TOKEN_B },
  ]);
  resetAgentBearerCacheForTests();
}

function buildBackend(store: MemoryOrchestrationQueueStore): AgentConsumerBackend {
  return { memory: store, queue: store };
}

function handlerDeps(store: MemoryOrchestrationQueueStore) {
  return {
    isCamEnabled: () => true,
    isConsumerEnabled: () => true,
    isBearerConfigured: () => true,
    orchestrationResolvable: () => true,
    resolveBackend: async () => buildBackend(store),
    now: () => NOW,
    verifyBearer: (request: Request) => {
      const header = request.headers.get("authorization") ?? "";
      if (header.includes(TOKEN_A)) return AGENT_A;
      if (header.includes(TOKEN_B)) return AGENT_B;
      return null;
    },
  };
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

async function seedReadyJob(store: MemoryOrchestrationQueueStore, jobId = "job-consumer-1") {
  store.registerAgentSync(createTestAgent({ id: AGENT_A }));
  store.registerAgentSync(
    createTestAgent({
      id: AGENT_B,
      capabilities: ["prepare_plan"],
    }),
  );
  const job = await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-1",
    description: "Consumer test job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    externalRefs: { correlationKey: "corr-phase2" },
    now: NOW,
  });
  assert.equal(job.state, "ready");
  return job;
}

test("agent consumer rejects requests when disabled", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerAgentConsumerResponse(new Request("http://local/assignments"), {
    isCamEnabled: () => true,
    isConsumerEnabled: () => false,
    resolveBackend: async () => buildBackend(store),
  });
  assert.equal(response.status, 503);
});

test("agent consumer rejects missing bearer", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", { headers: authHeaders("wrong-token-12345678") }),
    handlerDeps(store),
  );
  assert.equal(response.status, 401);
});

test("agent consumer rejects completion when evidence is not durably persisted on assignment", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(store),
  );
  const claimBody = (await claim.json()) as { assignment: { id: string; lease: { fenceToken: number } } };
  store.evidenceStore.register({
    contractVersion: "central-agent-orchestration-evidence/v1",
    id: "ev-forged",
    jobId: "job-consumer-1",
    assignmentId: claimBody.assignment.id,
    agentId: AGENT_A,
    kind: "work_completed",
    source: "executor",
    verification: "verified",
    createdAt: NOW,
    artifactRef: null,
    diagnostic: null,
  });
  const complete = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        evidenceIds: ["ev-forged"],
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(complete.status, 409);
});

test("agent consumer claim complete flow validates evidence and fences", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store);

  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(store),
  );
  assert.equal(claim.status, 200);
  const claimBody = (await claim.json()) as { assignment: { id: string; lease: { fenceToken: number } } };
  const assignmentId = claimBody.assignment.id;
  const fence = claimBody.assignment.lease.fenceToken;

  const missingEvidence = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        assignmentId,
        leaseFenceToken: fence,
        evidenceIds: ["ev-missing"],
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(missingEvidence.status, 409);

  const evidence = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({
        action: "submit_evidence",
        assignmentId,
        leaseFenceToken: fence,
        evidence: { id: "ev-done-1", kind: "work_completed", artifactRef: "artifacts/out.json" },
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(evidence.status, 200);

  const complete = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        assignmentId,
        leaseFenceToken: fence,
        evidenceIds: ["ev-done-1"],
        idempotencyKey: "complete-key-12345678",
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(complete.status, 200);
  const completeBody = (await complete.json()) as { jobState: string; externalRefs?: { correlationKey?: string } };
  assert.equal(completeBody.jobState, "completed");
  assert.equal(completeBody.externalRefs?.correlationKey, "corr-phase2");

  const replay = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        assignmentId,
        leaseFenceToken: fence,
        evidenceIds: ["ev-done-1"],
        idempotencyKey: "complete-key-12345678",
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.deepEqual(replayBody, completeBody);
});

test("agent consumer rejects cross-agent assignment updates", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(store),
  );
  const claimBody = (await claim.json()) as { assignment: { id: string; lease: { fenceToken: number } } };

  const cross = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_B), "content-type": "application/json" },
      body: JSON.stringify({
        action: "heartbeat",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(cross.status, 409);
});

test("agent consumer rejects stale fence tokens", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(store),
  );
  const claimBody = (await claim.json()) as { assignment: { id: string } };

  const stale = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({
        action: "heartbeat",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: 9999,
      }),
    }),
    handlerDeps(store),
  );
  assert.equal(stale.status, 409);
});

test("agent consumer rejects malformed payloads", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  const bad = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "not-real" }),
    }),
    handlerDeps(store),
  );
  assert.equal(bad.status, 409);
});

test("concurrent claims cannot assign the same ready job twice", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-race");
  const first = claimNextAssignmentForAgentSync(store, AGENT_A, NOW);
  const second = claimNextAssignmentForAgentSync(store, AGENT_B, NOW);
  assert.ok(first);
  assert.equal(second, null);
});

test("expired lease recovery releases assignment before a new claim", async () => {
  setBearerEnv();
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-lease");
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(store),
  );
  const claimBody = (await claim.json()) as { assignment: { id: string; lease: { expiresAt: string } } };
  const expiredNow = new Date(Date.parse(claimBody.assignment.lease.expiresAt) + 1000).toISOString();
  store.reconcileLeasesSync(expiredNow);
  const reclaim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { ...authHeaders(TOKEN_A), "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(store),
  );
  assert.equal(reclaim.status, 200);
  const reclaimBody = (await reclaim.json()) as { assignment: { id: string } | null };
  assert.ok(reclaimBody.assignment);
  assert.notEqual(reclaimBody.assignment?.id, claimBody.assignment.id);
});
