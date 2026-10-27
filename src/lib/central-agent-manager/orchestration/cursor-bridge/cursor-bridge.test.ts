import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../../agent-consumer-handler";
import { createDurableOrchestrationQueueStore } from "../durable-orchestration-queue-store";
import { isCursorBridgeEnabled } from "../flags";
import { createInMemoryOrchestrationSqlPort } from "../in-memory-orchestration-sql-port";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createTestAgent, NOW } from "../test-fixtures";
import { serializeManagerJob } from "../contracts-v1";
import {
  createCursorBridgeHarness,
  runCursorBridgeAssignmentCycle,
  type CursorBridgeDeps,
} from "./cursor-bridge";
import { CursorBridgeDispatchRegistry } from "./cursor-bridge-dispatch-registry";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

const BRIDGE_AGENT = "cursor-bridge-agent";
const TOKEN = "cursor-bridge-token-12345678";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [
    {
      projectId: "medimori",
      repoUrl: "https://github.com/example/medimori",
      startingRef: "main",
    },
  ],
});

async function seedReadyJob(
  store: MemoryOrchestrationQueueStore,
  jobId = "job-cursor-bridge",
  options?: { maxAttempts?: number; retryEligible?: boolean },
) {
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-cursor",
    description: "Cursor bridge validation job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    externalRefs: { correlationKey: "cursor-bridge-phase4b1" },
    maxAttempts: options?.maxAttempts,
    retryEligible: options?.retryEligible,
    now: NOW,
  });
}

const DISPATCH_OWNER_A = "bridge-owner-alpha01";

const FAST_POLLING = {
  pollIntervalMs: 0,
  pollMaxDurationMs: 600_000,
  heartbeatMinIntervalMs: 0,
};

function buildDeps(input: {
  store: MemoryOrchestrationQueueStore;
  transport: FakeCursorCloudApiTransport;
  registry?: CursorBridgeDispatchRegistry;
  now?: () => string;
  dispatchOwnerId?: string;
}): CursorBridgeDeps {
  const { client, dispatchOwnerId } = createCursorBridgeHarness({
    store: input.store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: input.now ?? (() => NOW),
    dispatchOwnerId: input.dispatchOwnerId ?? DISPATCH_OWNER_A,
  });
  return {
    bridgeEnabled: () => true,
    transport: input.transport,
    config: BASE_CONFIG,
    store: input.store,
    consumer: client,
    dispatchOwnerId: input.dispatchOwnerId ?? dispatchOwnerId,
    dispatchRegistry: input.registry,
    polling: FAST_POLLING,
    sleep: async () => {},
    now: input.now ?? (() => NOW),
    bearerToken: TOKEN,
  };
}

test("cursor bridge flag stays disabled by default", () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED;
  delete process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED;
  assert.equal(isCursorBridgeEnabled(), false);
  if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED;
  else process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED = previous;
});

test("cursor bridge completes simulated REST lifecycle with durable correlation", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store);
  const transport = new FakeCursorCloudApiTransport();
  const result = await runCursorBridgeAssignmentCycle(buildDeps({ store, transport }));
  assert.ok(result);
  assert.equal(result?.jobState, "completed");
  assert.match(result?.cursorAgentId ?? "", /^bc-fake-/);
  assert.match(result?.cursorRunId ?? "", /^run-fake-/);
  const assignment = store.listAssignmentsSync().find((row) => row.id === result?.assignmentId);
  assert.equal(assignment?.externalRefs?.cursorAgentId, result?.cursorAgentId);
  assert.equal(assignment?.externalRefs?.cursorRunId, result?.cursorRunId);
  const job = store.getJobSync(result!.jobId);
  assert.equal(job?.externalRefs?.cursorAgentId, result?.cursorAgentId);
});

test("cursor bridge rejects unauthorized consumer bearer", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store);
  const { handlerDeps } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
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

test("cursor bridge does not claim owner approval required jobs", async () => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: "job-protected",
    projectId: "medimori",
    goalId: "goal-protected",
    description: "Protected merge",
    requestedOperation: "merge_main",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const transport = new FakeCursorCloudApiTransport();
  const result = await runCursorBridgeAssignmentCycle(buildDeps({ store, transport }));
  assert.equal(result, null);
  assert.equal(transport.runs.size, 0);
});

test("cursor bridge enforces single active dispatch in registry", () => {
  const registry = new CursorBridgeDispatchRegistry();
  registry.recordDispatch("asgn-a", "bc-fake-00000001", "run-fake-00000001");
  assert.throws(
    () => registry.assertCanDispatch("asgn-b"),
    /already has an active dispatch/,
  );
});

test("cursor bridge fails closed on Cursor create failure without retry", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-dispatch-fail", { maxAttempts: 1, retryEligible: false });
  const transport = new FakeCursorCloudApiTransport();
  transport.configureCreateFailure(true);
  await assert.rejects(
    () => runCursorBridgeAssignmentCycle(buildDeps({ store, transport })),
    /Fake Cursor API: createAgentWithInitialRun failed/,
  );
  const job = store.getJobSync("job-dispatch-fail");
  assert.equal(job?.state, "failed");
  assert.equal(transport.runs.size, 0);
});

test("correlate_external rejects conflicting cursor agent id", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-correlate-conflict");
  const { client, handlerDeps } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  assert.equal(await client.beginExternalDispatch(claim.assignment!, DISPATCH_OWNER_A), 200);
  assert.equal(await client.correlateExternal(claim.assignment!, { cursorAgentId: "bc-fake-00000001", cursorRunId: "run-fake-00000001" }), 200);
  const conflict = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claim.assignment!.id,
        leaseFenceToken: claim.assignment!.leaseFenceToken,
        externalRefs: { cursorAgentId: "bc-fake-OTHER0001", cursorRunId: "run-fake-00000002" },
      }),
    }),
    handlerDeps,
  );
  assert.equal(conflict.status, 400);
});

test("cursor bridge fails terminal Cursor run through CAM fail action", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-terminal-fail", { maxAttempts: 1, retryEligible: false });
  const transport = new FakeCursorCloudApiTransport();
  transport.configureImmediateTerminal("ERROR", "Simulated Cursor error.");
  await assert.rejects(
    () => runCursorBridgeAssignmentCycle(buildDeps({ store, transport })),
    /Simulated Cursor error/,
  );
  assert.equal(store.getJobSync("job-terminal-fail")?.state, "failed");
});

test("cursor bridge restart recovery resumes polling without second create", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-restart");
  const transport = new FakeCursorCloudApiTransport();
  const cursorAgentId = "bc-existing-restart01";
  const cursorRunId = "run-existing-restart01";
  transport.runs.set(`${cursorAgentId}:${cursorRunId}`, {
    request: { promptText: "resume", repoUrl: "https://github.com/example/medimori" },
    status: "CREATING",
    artifactPath: `artifacts/cursor-bridge/${cursorRunId}/outcome.json`,
  });
  const { client: resumeClient } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
  });
  const claim = await resumeClient.claim();
  assert.ok(claim.assignment);
  assert.equal(
    await resumeClient.beginExternalDispatch(claim.assignment!, DISPATCH_OWNER_A),
    200,
  );
  assert.equal(
    await resumeClient.correlateExternal(claim.assignment!, { cursorAgentId, cursorRunId }),
    200,
  );
  let createCalls = 0;
  const originalCreate = transport.createAgentWithInitialRun.bind(transport);
  transport.createAgentWithInitialRun = async (request) => {
    createCalls += 1;
    return originalCreate(request);
  };
  const result = await runCursorBridgeAssignmentCycle(buildDeps({ store, transport }));
  assert.equal(createCalls, 0);
  assert.equal(result?.cursorAgentId, cursorAgentId);
  assert.equal(result?.jobState, "completed");
});

test("cursor bridge correlate_external persists through durable assignment payload", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const store = durable.getMemoryStore();
  await seedReadyJob(store, "job-durable-cursor");
  store.refreshDependencyReadinessSync(NOW);
  const readyJob = store.getJobSync("job-durable-cursor");
  assert.ok(readyJob);
  await sql.upsertJob({ id: readyJob.id, payload_json: serializeManagerJob(readyJob), updated_at: readyJob.updatedAt });
  for (const agent of store.listAgentsSync()) {
    await sql.upsertAgent({
      id: agent.id,
      payload_json: JSON.stringify(agent),
      updated_at: agent.lastObservedAt ?? NOW,
    });
  }
  const { handlerDeps } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
  });
  const backend = {
    get memory() {
      return durable.getMemoryStore();
    },
    queue: durable,
    reloadFromSql: () => durable.reloadFromSql(),
    claimNextAssignment: (agentId: string, now: string, options?: { jobId?: string }) =>
      durable.claimNextAssignmentForAgent(agentId, now, options),
    heartbeatAssignment: (
      agentId: string,
      assignmentId: string,
      fenceToken: number,
      now: string,
      progress?: { diagnostic?: string | null; artifactRef?: string | null },
    ) => durable.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
    persistAssignmentJobMutation: (
      assignmentId: string,
      fenceToken: number,
      allowed?: readonly string[],
    ) => durable.persistAssignmentJobMutation(assignmentId, fenceToken, allowed),
  };
  const claim = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    { ...handlerDeps, resolveBackend: async () => backend },
  );
  assert.equal(claim.status, 200);
  const claimBody = (await claim.json()) as {
    assignment: { id: string; lease: { fenceToken: number } };
  };
  const begin = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        dispatchOwnerId: DISPATCH_OWNER_A,
      }),
    }),
    { ...handlerDeps, resolveBackend: async () => backend },
  );
  assert.equal(begin.status, 200);
  const correlate = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "correlate_external",
        assignmentId: claimBody.assignment.id,
        leaseFenceToken: claimBody.assignment.lease.fenceToken,
        externalRefs: { cursorAgentId: "bc-fake-durable01", cursorRunId: "run-fake-durable01" },
      }),
    }),
    { ...handlerDeps, resolveBackend: async () => backend },
  );
  assert.equal(correlate.status, 200);
  await durable.reloadFromSql();
  const reloaded = durable.getMemoryStore().listAssignmentsSync().find((row) => row.id === claimBody.assignment.id);
  assert.equal(reloaded?.externalRefs?.cursorAgentId, "bc-fake-durable01");
  assert.equal(reloaded?.cursorDispatchIntent?.state, "external_confirmed");
});

test("cursor bridge heartbeat fails after lease expiration", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seedReadyJob(store, "job-lease-expire");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => "2026-10-24T18:00:00.000Z",
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  store.reconcileLeasesSync("2026-10-24T19:30:00.000Z");
  const heartbeat = await client.heartbeat(claim.assignment!, { diagnostic: "late" });
  assert.equal(heartbeat, 409);
});
