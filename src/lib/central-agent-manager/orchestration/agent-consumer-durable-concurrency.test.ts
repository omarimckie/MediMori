import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { createTestAgent, NOW } from "./test-fixtures";
import { serializeManagerJob } from "./contracts-v1";
import type { AgentConsumerBackend } from "./queue-store-factory";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  resetAgentBearerCacheForTests,
} from "./agent-consumer-auth";
import { baseJobFixture } from "./test-fixtures";
import { jobRequiresLiveOwnerApproval } from "./approval-integration";
import { DEFAULT_LEASE_MS } from "./assignment-lifecycle";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const TOKEN_A = "token-agent-a-12345678";
const TOKEN_B = "token-agent-b-12345678";

function durableBackend(durable: Awaited<ReturnType<typeof createDurableOrchestrationQueueStore>>): AgentConsumerBackend {
  return {
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
}

function handlerDeps(backend: AgentConsumerBackend, agentId: string, token: string) {
  return {
    isCamEnabled: () => true,
    isConsumerEnabled: () => true,
    isBearerConfigured: () => true,
    orchestrationResolvable: () => true,
    resolveBackend: async () => backend,
    now: () => NOW,
    verifyBearer: (request: Request) =>
      request.headers.get("authorization")?.includes(token) ? agentId : null,
  };
}

async function seedReadyJobOnSql(sql: ReturnType<typeof createInMemoryOrchestrationSqlPort>, jobId: string) {
  const job = baseJobFixture({
    id: jobId,
    state: "ready",
    requiredCapabilities: ["prepare_plan"],
  });
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAgent({
    id: AGENT_A,
    payload_json: JSON.stringify(createTestAgent({ id: AGENT_A })),
    updated_at: NOW,
  });
  await sql.upsertAgent({
    id: AGENT_B,
    payload_json: JSON.stringify(createTestAgent({ id: AGENT_B })),
    updated_at: NOW,
  });
}

test("in-memory sql: concurrent consumer claims yield one winner (shared database)", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-durable-race");
  const durableA = await createDurableOrchestrationQueueStore(sql);
  const durableB = await createDurableOrchestrationQueueStore(sql);
  const [claimA, claimB] = await Promise.all([
    durableA.claimNextAssignmentForAgent(AGENT_A, NOW),
    durableB.claimNextAssignmentForAgent(AGENT_B, NOW),
  ]);
  const winners = [claimA, claimB].filter(Boolean);
  assert.equal(winners.length, 1);
  const assignments = await sql.loadAssignments();
  assert.equal(assignments.length, 1);
});

test("durable handler claim uses atomic path and persists single assignment", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
    { agentId: AGENT_B, token: TOKEN_B },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-handler-race");
  const durableA = await createDurableOrchestrationQueueStore(sql);
  const durableB = await createDurableOrchestrationQueueStore(sql);
  const [responseA, responseB] = await Promise.all([
    centralAgentManagerAgentConsumerResponse(
      new Request("http://local/assignments", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      }),
      handlerDeps(durableBackend(durableA), AGENT_A, TOKEN_A),
    ),
    centralAgentManagerAgentConsumerResponse(
      new Request("http://local/assignments", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN_B}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      }),
      handlerDeps(durableBackend(durableB), AGENT_B, TOKEN_B),
    ),
  ]);
  const bodyA = (await responseA.json()) as { assignment: { id: string } | null };
  const bodyB = (await responseB.json()) as { assignment: { id: string } | null };
  assert.equal(Boolean(bodyA.assignment) !== Boolean(bodyB.assignment), true);
  assert.equal((await sql.loadAssignments()).length, 1);
});

test("durable heartbeat renews lease in database and rejects stale fence", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-heartbeat");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const extended = await durable.heartbeatAssignmentForAgent(
    AGENT_A,
    claim.id,
    claim.lease.fenceToken,
    NOW,
  );
  assert.ok(Date.parse(extended.lease.expiresAt) >= Date.parse(claim.lease.expiresAt));
  await assert.rejects(
    () =>
      durable.heartbeatAssignmentForAgent(AGENT_A, claim.id, claim.lease.fenceToken - 1, NOW),
    /stale/i,
  );
});

test("concurrent heartbeat and lease expiry rejects stale fence", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-lease-race");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const expiredAt = new Date(Date.parse(claim.lease.expiresAt) + DEFAULT_LEASE_MS).toISOString();
  durable.getMemoryStore().reconcileLeasesSync(expiredAt);
  await sql.upsertJob({
    id: claim.jobId,
    payload_json: serializeManagerJob(durable.getMemoryStore().getJobSync(claim.jobId)!),
    updated_at: expiredAt,
  });
  const row = (await sql.loadAssignments()).find((entry) => entry.id === claim.id);
  assert.ok(row);
  await assert.rejects(
    () =>
      durable.heartbeatAssignmentForAgent(AGENT_A, claim.id, claim.lease.fenceToken, expiredAt),
    /stale|fence|lease/i,
  );
});

test("concurrent dispatch intent: second owner receives 409", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-dispatch-compete");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const backend = durableBackend(durable);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  const claimBody = (await claim.json()) as {
    assignment: { id: string; lease: { fenceToken: number } };
  };
  const ownerA = "bridge-owner-alpha01";
  const ownerB = "bridge-owner-bravo02";
  const first = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        dispatchOwnerId: ownerA,
      }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  assert.equal(first.status, 200);
  const conflict = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        dispatchOwnerId: ownerB,
      }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  assert.equal(conflict.status, 409);
});

test("correlation persists with fence and survives reload", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-correlate");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const backend = durableBackend(durable);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  const claimBody = (await claim.json()) as {
    assignment: { id: string; lease: { fenceToken: number } };
  };
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        dispatchOwnerId: "bridge-owner-alpha01",
      }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  const correlate = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        externalRefs: { cursorAgentId: "bc-fake-00000001", cursorRunId: "run-fake-00000001" },
      }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  assert.equal(correlate.status, 200);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const assignment = reloaded.getMemoryStore().listAssignmentsSync()[0];
  assert.equal(assignment?.cursorDispatchIntent?.state, "external_confirmed");
  assert.equal(assignment?.externalRefs?.cursorAgentId, "bc-fake-00000001");
});

test("recovery-required state survives durable reload", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-recovery");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const backend = durableBackend(durable);
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  assert.equal(claim.status, 200);
  const claimBody = (await claim.json()) as {
    assignment: { id: string; lease: { fenceToken: number } };
  };
  assert.ok(claimBody.assignment);
  const escalate = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "escalate_external_dispatch_recovery",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        reason: "Operator review required.",
      }),
    }),
    handlerDeps(backend, AGENT_A, TOKEN_A),
  );
  assert.equal(escalate.status, 200);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const assignment = reloaded.getMemoryStore().listAssignmentsSync()[0];
  assert.equal(assignment?.state, "ambiguous");
  assert.equal(assignment?.cursorDispatchIntent?.state, "recovery_required");
  assert.equal(reloaded.getMemoryStore().getJobSync(assignment!.jobId)?.state, "blocked");
});

test("owner reconcileLeases reloads sql before full persist so consumer correlation survives", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJobOnSql(sql, "job-owner-reconcile");
  const owner = await createDurableOrchestrationQueueStore(sql);
  const claim = await owner.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const consumerStore = await createDurableOrchestrationQueueStore(sql);
  const consumerBackend = durableBackend(consumerStore);
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        dispatchOwnerId: "bridge-owner-reconcile",
      }),
    }),
    handlerDeps(consumerBackend, AGENT_A, TOKEN_A),
  );
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        externalRefs: { cursorAgentId: "bc-fake-00000003", cursorRunId: "run-fake-00000003" },
      }),
    }),
    handlerDeps(consumerBackend, AGENT_A, TOKEN_A),
  );
  await owner.reconcileLeases(NOW);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const assignment = reloaded.getMemoryStore().listAssignmentsSync()[0];
  assert.equal(assignment?.externalRefs?.cursorAgentId, "bc-fake-00000003");
  assert.equal(assignment?.cursorDispatchIntent?.state, "external_confirmed");
});

test("protected jobs awaiting owner approval are not claimable", () => {
  const job = baseJobFixture({
    id: "job-protected",
    state: "ready",
    ownerAuthorizationScope: "owner_approval_required",
    requestedOperation: "engineering_merge",
    approvalBinding: null,
  });
  assert.equal(jobRequiresLiveOwnerApproval(job, NOW), true);
});
