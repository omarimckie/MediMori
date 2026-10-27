import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import { centralAgentManagerDispatchRecoveryResponse } from "../dispatch-recovery-handler";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  resetAgentBearerCacheForTests,
} from "./agent-consumer-auth";
import type { AgentConsumerBackend } from "./queue-store-factory";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { baseJobFixture, createTestAgent, NOW } from "./test-fixtures";
import { serializeManagerJob } from "./contracts-v1";
import { DEFAULT_LEASE_MS } from "./assignment-lifecycle";
import { acceptOrchestrationEvidence } from "./orchestration-evidence";
import { FakeCursorCloudApiTransport } from "./cursor-bridge/fake-cursor-cloud-api-transport";
import { createCursorBridgeHarness, runCursorBridgeAssignmentCycle } from "./cursor-bridge/cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge/cursor-bridge-config";
import { CURSOR_BRIDGE_TEST_POLLING } from "./cursor-bridge/cursor-bridge-test-harness";
import { ownerConfirmVerifiedCursorIdsSync } from "./cursor-dispatch-recovery-operations";
import { requireDispatchRecoverySync } from "./cursor-dispatch-intent";

const AGENT_A = "cursor-bridge-agent";
const TOKEN_A = "cursor-bridge-token-12345678";
const OWNER = "owner-alpha";
const DISPATCH_OWNER = "bridge-owner-alpha01";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: AGENT_A,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

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

async function seedReadyJob(sql: ReturnType<typeof createInMemoryOrchestrationSqlPort>, jobId: string) {
  const job = baseJobFixture({ id: jobId, state: "ready", requiredCapabilities: ["prepare_plan"] });
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAgent({
    id: AGENT_A,
    payload_json: JSON.stringify(createTestAgent({ id: AGENT_A })),
    updated_at: NOW,
  });
}

test("owner refreshDependencyReadiness does not overwrite consumer dispatch confirmation", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-owner-refresh");
  const owner = await createDurableOrchestrationQueueStore(sql);
  const consumer = await createDurableOrchestrationQueueStore(sql);
  const claim = await consumer.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const backend = durableBackend(consumer);
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        dispatchOwnerId: DISPATCH_OWNER,
      }),
    }),
    handlerDeps(backend),
  );
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        externalRefs: { cursorAgentId: "bc-cross-00000001", cursorRunId: "run-cross-00000001" },
      }),
    }),
    handlerDeps(backend),
  );
  await owner.refreshDependencyReadiness(NOW);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const assignment = reloaded.getMemoryStore().listAssignmentsSync()[0];
  assert.equal(assignment?.externalRefs?.cursorAgentId, "bc-cross-00000001");
});

test("consumer claim followed by owner reconcile preserves consumer correlation", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-owner-reconcile-stale");
  const owner = await createDurableOrchestrationQueueStore(sql);
  const claim = await owner.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const consumer = await createDurableOrchestrationQueueStore(sql);
  const consumerBackend = durableBackend(consumer);
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        dispatchOwnerId: DISPATCH_OWNER,
      }),
    }),
    handlerDeps(consumerBackend),
  );
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        externalRefs: { cursorAgentId: "bc-cross-00000002", cursorRunId: "run-cross-00000002" },
      }),
    }),
    handlerDeps(consumerBackend),
  );
  await owner.reconcileLeases(NOW);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const assignment = reloaded.getMemoryStore().listAssignmentsSync()[0];
  assert.equal(assignment?.externalRefs?.cursorAgentId, "bc-cross-00000002");
});

test("consumer dispatch confirmation survives owner scheduler tick without duplicate claim", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-scheduler-stale");
  const owner = await createDurableOrchestrationQueueStore(sql);
  const claim = await owner.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const consumer = await createDurableOrchestrationQueueStore(sql);
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        dispatchOwnerId: DISPATCH_OWNER,
      }),
    }),
    handlerDeps(durableBackend(consumer)),
  );
  await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claim.id,
        leaseFenceToken: claim.lease.fenceToken,
        externalRefs: { cursorAgentId: "bc-cross-00000003", cursorRunId: "run-cross-00000003" },
      }),
    }),
    handlerDeps(durableBackend(consumer)),
  );
  await owner.runScheduler(NOW);
  const assignments = await sql.loadAssignments();
  assert.equal(assignments.length, 1);
  const parsed = JSON.parse(assignments[0]!.payload_json) as { externalRefs?: { cursorAgentId?: string } };
  assert.equal(parsed.externalRefs?.cursorAgentId, "bc-cross-00000003");
});

test("owner recovery confirm preserves audit trail across durable reload", async () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: AGENT_A, token: TOKEN_A },
  ]);
  resetAgentBearerCacheForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-recovery-audit");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const backend = durableBackend(durable);
  const claimResponse = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    handlerDeps(backend),
  );
  const claimBody = (await claimResponse.json()) as {
    assignment: { id: string; lease: { fenceToken: number } };
  };
  await centralAgentManagerAgentConsumerResponse(
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
    handlerDeps(backend),
  );
  ownerConfirmVerifiedCursorIdsSync(durable.getMemoryStore(), {
    assignmentId: claimBody.assignment.id,
    ownerUsername: OWNER,
    auditId: "audit-cross-writer-01",
    now: NOW,
    externalRefs: { cursorAgentId: "bc-recovery-00000001", cursorRunId: "run-recovery-00000001" },
  });
  await durable.persistAssignmentJobMutation(
    claimBody.assignment.id,
    claimBody.assignment.lease.fenceToken,
    ["active", "ambiguous"],
  );
  await durable.reloadFromSql();
  const assignment = durable.getMemoryStore().listAssignmentsSync()[0];
  assert.equal(assignment?.cursorDispatchRecoveryAudit?.length, 1);
  assert.equal(assignment?.cursorDispatchRecoveryAudit?.[0]?.id, "audit-cross-writer-01");
  const response = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", { method: "GET" }),
    {
      isEnabled: () => true,
      isOwnerConfigured: () => true,
      recoveryEnabled: () => true,
      isOwner: (u) => u === OWNER,
      getUsername: async () => OWNER,
      resolveStore: async () => durable,
      now: () => NOW,
    },
  );
  assert.equal(response.status, 200);
});

test("stale lease heartbeat and completion are rejected after durable lease expiry", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-stale-terminal");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const expiredAt = new Date(Date.parse(claim.lease.expiresAt) + DEFAULT_LEASE_MS).toISOString();
  await durable.reconcileLeases(expiredAt);
  await assert.rejects(
    () => durable.heartbeatAssignmentForAgent(AGENT_A, claim.id, claim.lease.fenceToken, expiredAt),
    /stale|fence|lease|not active/i,
  );
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.notEqual(reloaded.getMemoryStore().listAssignmentsSync()[0]?.state, "completed");
});

test("concurrent terminal completion attempts yield one winner", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-terminal-race");
  const durableA = await createDurableOrchestrationQueueStore(sql);
  const durableB = await createDurableOrchestrationQueueStore(sql);
  const claim = await durableA.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const evidenceId = "ev-terminal-race";
  durableA.getMemoryStore().persistOrchestrationEvidenceSync(
    claim.id,
    acceptOrchestrationEvidence({
      id: evidenceId,
      jobId: claim.jobId,
      assignmentId: claim.id,
      agentId: AGENT_A,
      kind: "work_completed",
      createdAt: NOW,
      artifactRef: "artifacts/out.json",
    }),
    NOW,
  );
  await durableA.persistAssignmentJobMutation(claim.id, claim.lease.fenceToken, ["active"]);
  await durableA.completeAssignment(claim.id, NOW, [evidenceId]);
  await durableB.completeAssignment(claim.id, NOW, [evidenceId]);
  const row = (await sql.loadAssignments()).find((entry) => entry.id === claim.id);
  assert.ok(row);
  const parsed = JSON.parse(row.payload_json) as { state: string };
  assert.equal(parsed.state, "completed");
  const job = (await createDurableOrchestrationQueueStore(sql)).getMemoryStore().getJobSync(claim.jobId);
  assert.equal(job?.state, "completed");
});

test("protected approval binding is preserved when owner refreshes readiness", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const job = baseJobFixture({
    id: "job-protected-cross",
    state: "ready",
    ownerAuthorizationScope: "owner_approval_required",
    requestedOperation: "engineering_merge",
    approvalBinding: {
      supervisorTaskId: "task-protected",
      operation: "engineering_merge",
      approvalRecordId: "approval-record-abc",
      expiresAt: "2099-01-01T00:00:00.000Z",
      revokedAt: null,
    },
  });
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  const durable = await createDurableOrchestrationQueueStore(sql);
  await durable.refreshDependencyReadiness(NOW);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.equal(
    reloaded.getMemoryStore().getJobSync(job.id)?.approvalBinding?.approvalRecordId,
    "approval-record-abc",
  );
});

test("confirmed external ids resume without second create after durable reload", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-no-dup-create");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const store = durable.getMemoryStore();
  requireDispatchRecoverySync(store, AGENT_A, claim.id, claim.lease.fenceToken, NOW, "Ambiguous create.");
  ownerConfirmVerifiedCursorIdsSync(store, {
    assignmentId: claim.id,
    ownerUsername: OWNER,
    auditId: "audit-resume-01",
    now: NOW,
    externalRefs: { cursorAgentId: "bc-resume-00000001", cursorRunId: "run-resume-00000001" },
  });
  await durable.persistAssignmentJobMutation(claim.id, claim.lease.fenceToken, ["active", "ambiguous"]);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const { client } = createCursorBridgeHarness({
    store: reloaded.getMemoryStore(),
    config: BASE_CONFIG,
    bearerToken: TOKEN_A,
    now: () => NOW,
    dispatchOwnerId: DISPATCH_OWNER,
  });
  const transport = new FakeCursorCloudApiTransport();
  transport.runs.set("bc-resume-00000001:run-resume-00000001", {
    request: { promptText: "x", repoUrl: "https://github.com/example/medimori" },
    status: "FINISHED",
    artifactPath: "artifacts/cursor-bridge/outcome.json",
  });
  await runCursorBridgeAssignmentCycle({
    bridgeEnabled: () => true,
    transport,
    config: BASE_CONFIG,
    store: reloaded.getMemoryStore(),
    consumer: client,
    dispatchOwnerId: DISPATCH_OWNER,
    polling: CURSOR_BRIDGE_TEST_POLLING,
    sleep: async () => {},
    now: () => NOW,
    bearerToken: TOKEN_A,
  });
  assert.equal(transport.createCallCount, 0);
  assert.equal(reloaded.getMemoryStore().getJobSync(claim.jobId)?.state, "completed");
});
