import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../../agent-consumer-handler";
import { CURSOR_DISPATCH_INTENT_CONTRACT_V1 } from "../cursor-dispatch-intent";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createTestAgent, NOW } from "../test-fixtures";
import {
  createCursorBridgeHarness,
  runCursorBridgeAssignmentCycle,
} from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

const BRIDGE_AGENT = "cursor-bridge-agent";
const TOKEN = "cursor-bridge-token-12345678";
const OWNER_A = "bridge-owner-alpha01";
const OWNER_B = "bridge-owner-bravo02";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

const FAST_POLLING = {
  pollIntervalMs: 0,
  pollMaxDurationMs: 600_000,
  heartbeatMinIntervalMs: 0,
};

function bridgeCycleDeps(input: {
  store: MemoryOrchestrationQueueStore;
  transport: FakeCursorCloudApiTransport;
  client: ReturnType<typeof createCursorBridgeHarness>["client"];
  dispatchOwnerId: string;
  maxPollIterations?: number;
  now?: () => string;
}) {
  return {
    bridgeEnabled: () => true,
    transport: input.transport,
    config: BASE_CONFIG,
    store: input.store,
    consumer: input.client,
    dispatchOwnerId: input.dispatchOwnerId,
    maxPollIterations: input.maxPollIterations,
    polling: FAST_POLLING,
    sleep: async () => {},
    now: input.now ?? (() => NOW),
    bearerToken: TOKEN,
  };
}

async function seed(store: MemoryOrchestrationQueueStore, jobId: string) {
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal",
    description: "hardening job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
}

test("crash before external create leaves dispatch_in_progress then escalates on restart", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-crash-before-create");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  assert.equal(await client.beginExternalDispatch(claim.assignment!, OWNER_A), 200);
  const assignment = store.listAssignmentsSync().find((row) => row.id === claim.assignment!.id);
  assert.equal(assignment?.cursorDispatchIntent?.state, "dispatch_in_progress");
  await assert.rejects(
    () =>
      runCursorBridgeAssignmentCycle(
        bridgeCycleDeps({
          store,
          transport: new FakeCursorCloudApiTransport(),
          client,
          dispatchOwnerId: OWNER_A,
        }),
      ),
    /operator recovery/,
  );
  const after = store.listAssignmentsSync().find((row) => row.id === claim.assignment!.id);
  assert.equal(after?.state, "ambiguous");
  assert.equal(after?.cursorDispatchIntent?.state, "recovery_required");
});

test("crash after external create without id persistence escalates recovery", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-crash-after-create");
  const transport = new FakeCursorCloudApiTransport();
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  assert.equal(await client.beginExternalDispatch(claim.assignment!, OWNER_A), 200);
  await transport.createAgentWithInitialRun({
    promptText: "orphan",
    repoUrl: "https://github.com/example/medimori",
  });
  await client.escalateExternalDispatchRecovery(
    claim.assignment!,
    "External create succeeded but correlation did not persist.",
  );
  const assignment = store.listAssignmentsSync().find((row) => row.id === claim.assignment!.id);
  assert.equal(assignment?.state, "ambiguous");
  assert.equal(assignment?.cursorDispatchIntent?.state, "recovery_required");
  assert.equal(transport.runs.size, 1);
});

test("ambiguous polling timeout escalates recovery instead of redispatching", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-timeout");
  const transport = new FakeCursorCloudApiTransport();
  transport.configurePollsBeforeFinished(100);
  const { client, dispatchOwnerId } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  await assert.rejects(
    () =>
      runCursorBridgeAssignmentCycle(
        bridgeCycleDeps({
          store,
          transport,
          client,
          dispatchOwnerId,
          maxPollIterations: 4,
        }),
      ),
    /polling exceeded/,
  );
  const assignment = store.listAssignmentsSync()[0];
  assert.equal(assignment?.state, "ambiguous");
  assert.equal(assignment?.cursorDispatchIntent?.state, "recovery_required");
  assert.equal(store.getJobSync("job-timeout")?.state, "blocked");
});

test("two competing bridge owners cannot both begin external dispatch", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-compete");
  const { client, handlerDeps } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  assert.equal(await client.beginExternalDispatch(claim.assignment!, OWNER_A), 200);
  const conflict = await centralAgentManagerAgentConsumerResponse(
    new Request("http://local/assignments", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "begin_external_dispatch",
        assignmentId: claim.assignment!.id,
        leaseFenceToken: claim.assignment!.leaseFenceToken,
        dispatchOwnerId: OWNER_B,
      }),
    }),
    handlerDeps,
  );
  assert.equal(conflict.status, 409);
});

test("stale lease blocks correlation", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-stale-correlate");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => "2026-10-24T18:00:00.000Z",
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  assert.equal(await client.beginExternalDispatch(claim.assignment!, OWNER_A), 200);
  store.reconcileLeasesSync("2026-10-24T19:30:00.000Z");
  const correlate = await client.correlateExternal(claim.assignment!, {
    cursorAgentId: "bc-fake-stale001",
    cursorRunId: "run-fake-stale001",
  });
  assert.equal(correlate, 409);
});

test("recovery-required assignment cannot be automatically redispatched", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-no-redispatch");
  const transport = new FakeCursorCloudApiTransport();
  const { client, dispatchOwnerId } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  await client.escalateExternalDispatchRecovery(claim.assignment!, "Operator review required.");
  const result = await runCursorBridgeAssignmentCycle(
    bridgeCycleDeps({ store, transport, client, dispatchOwnerId }),
  );
  assert.equal(result, null);
  assert.equal(transport.runs.size, 0);
});

test("restart with confirmed ids resumes without a second create", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-restart-confirmed");
  const transport = new FakeCursorCloudApiTransport();
  const cursorAgentId = "bc-existing-restart02";
  const cursorRunId = "run-existing-restart02";
  transport.runs.set(`${cursorAgentId}:${cursorRunId}`, {
    request: { promptText: "resume", repoUrl: "https://github.com/example/medimori" },
    status: "CREATING",
    artifactPath: `artifacts/cursor-bridge/${cursorRunId}/outcome.json`,
  });
  const { client, dispatchOwnerId } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  await client.beginExternalDispatch(claim.assignment!, OWNER_A);
  await client.correlateExternal(claim.assignment!, { cursorAgentId, cursorRunId });
  let createCalls = 0;
  const originalCreate = transport.createAgentWithInitialRun.bind(transport);
  transport.createAgentWithInitialRun = async (request) => {
    createCalls += 1;
    return originalCreate(request);
  };
  const result = await runCursorBridgeAssignmentCycle(
    bridgeCycleDeps({ store, transport, client, dispatchOwnerId }),
  );
  assert.equal(createCalls, 0);
  assert.equal(result?.cursorAgentId, cursorAgentId);
  const assignment = store.listAssignmentsSync().find((row) => row.id === claim.assignment!.id);
  assert.equal(assignment?.cursorDispatchIntent?.state, "external_confirmed");
});

test("job and assignment dispatch intent stay mirrored on begin", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-mirror-intent");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  const claim = await client.claim();
  assert.ok(claim.assignment);
  await client.beginExternalDispatch(claim.assignment!, OWNER_A);
  const assignment = store.listAssignmentsSync()[0];
  const job = store.getJobSync("job-mirror-intent");
  assert.equal(assignment?.cursorDispatchIntent?.contractVersion, CURSOR_DISPATCH_INTENT_CONTRACT_V1);
  assert.deepEqual(job?.cursorDispatchIntent, assignment?.cursorDispatchIntent);
});
