import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../../agent-consumer-handler";
import type { AgentConsumerBackend } from "../queue-store-factory";
import { createDurableOrchestrationQueueStore } from "../durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "../in-memory-orchestration-sql-port";
import { claimNextAssignmentForAgentSync } from "../agent-consumer-operations";
import { serializeManagerJob } from "../contracts-v1";
import { createTestAgent, NOW } from "../test-fixtures";
import { createMockSpecialistHarness } from "../mock-specialist-agent";
import { CursorBridgeConsumerClient } from "./cursor-bridge-consumer-client";
import { runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { CURSOR_BRIDGE_TEST_POLLING, describeCursorBridgeTests } from "./cursor-bridge-test-harness";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

const BRIDGE_AGENT = "cursor-bridge-durable-e2e";
const TOKEN = "cursor-bridge-durable-token-12345678";
const OWNER = "bridge-durable-owner01";

function setBearerEnv() {
  process.env.CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON = JSON.stringify([
    { agentId: BRIDGE_AGENT, token: TOKEN },
  ]);
}

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

function durableBackend(
  durable: Awaited<ReturnType<typeof createDurableOrchestrationQueueStore>>,
): AgentConsumerBackend {
  const memory = () => durable.getMemoryStore();
  return {
    get memory() {
      return memory();
    },
    get queue() {
      return memory();
    },
    // Avoid reloading SQL between in-memory claim and mutation in this offline integration harness.
    reloadFromSql: async () => undefined,
    persistAssignmentJobMutation: async () => {
      // Final `persistMutations()` snapshots memory to SQL for reconstruction assertions.
    },
  };
}

async function seedDurableReadyJob(
  durable: Awaited<ReturnType<typeof createDurableOrchestrationQueueStore>>,
  jobId: string,
) {
  const memory = durable.getMemoryStore();
  memory.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await durable.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-durable-e2e",
    description: "durable offline bridge lifecycle",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    externalRefs: { correlationKey: `durable-${jobId}` },
    now: NOW,
  });
  memory.refreshDependencyReadinessSync(NOW);
  await durable.persistMutations();
}

function bridgeClientForDurable(
  durable: Awaited<ReturnType<typeof createDurableOrchestrationQueueStore>>,
) {
  const store = durable.getMemoryStore();
  const backend = durableBackend(durable);
  const { handlerDeps } = createMockSpecialistHarness({
    store,
    backend,
    agentId: BRIDGE_AGENT,
    bearerToken: TOKEN,
    now: () => NOW,
  });
  const client = new CursorBridgeConsumerClient({
    agentId: BRIDGE_AGENT,
    bearerToken: TOKEN,
    handlerDeps,
  });
  return { client, store, handlerDeps, backend };
}

/**
 * Offline durable harness: consumer reload is disabled between steps so in-memory bridge cycles
 * can complete; SQL snapshots are written explicitly before reconstruction assertions.
 * Production HTTP consumers must persist each assignment mutation before reload (see handler reloadConsumerState).
 */
describeCursorBridgeTests("cursor-bridge-durable-offline-lifecycle", () => {
  test("enqueue, fake transport cycle, evidence, completion, and durable reconstruction", async () => {
    setBearerEnv();
    const sql = createInMemoryOrchestrationSqlPort();
    const durable = await createDurableOrchestrationQueueStore(sql);
    await seedDurableReadyJob(durable, "job-durable-bridge-full");
    const { client, store } = bridgeClientForDurable(durable);
    const transport = new FakeCursorCloudApiTransport();
    let liveCreates = 0;
    const originalCreate = transport.createAgentWithInitialRun.bind(transport);
    transport.createAgentWithInitialRun = async (req) => {
      liveCreates += 1;
      return originalCreate(req);
    };
    const result = await runCursorBridgeAssignmentCycle({
      bridgeEnabled: () => true,
      transport,
      config: BASE_CONFIG,
      store,
      consumer: client,
      dispatchOwnerId: OWNER,
      bearerToken: TOKEN,
      now: () => NOW,
      polling: CURSOR_BRIDGE_TEST_POLLING,
      reserveExternalCreateBudget: async () => {},
    });
    assert.ok(result);
    assert.equal(liveCreates, 1);
    assert.equal(result.jobState, "completed");
    assert.equal(store.getJobSync("job-durable-bridge-full")?.state, "completed");
    const completedJob = store.getJobSync("job-durable-bridge-full");
    assert.ok(completedJob);
    await sql.upsertJob({
      id: completedJob.id,
      payload_json: serializeManagerJob(completedJob),
      updated_at: completedJob.updatedAt,
    });
    const completedAssignment = store
      .listAssignmentsSync()
      .find((row) => row.jobId === "job-durable-bridge-full");
    if (completedAssignment) {
      await sql.upsertAssignment({
        id: completedAssignment.id,
        job_id: completedAssignment.jobId,
        payload_json: JSON.stringify(completedAssignment),
        updated_at: completedAssignment.updatedAt,
      });
    }
    await durable.persistMutations();

    const reloaded = await createDurableOrchestrationQueueStore(sql);
    const job = reloaded.getMemoryStore().getJobSync("job-durable-bridge-full");
    assert.equal(job?.state, "completed");
    const assignment = reloaded
      .getMemoryStore()
      .listAssignmentsSync()
      .find((row) => row.jobId === "job-durable-bridge-full");
    assert.equal(assignment?.state, "completed");
    assert.equal(claimNextAssignmentForAgentSync(reloaded.getMemoryStore(), BRIDGE_AGENT, NOW), null);
  });

  test("stale fencing rejected after durable reload; lease token unchanged", async () => {
    setBearerEnv();
    const sql = createInMemoryOrchestrationSqlPort();
    const durable = await createDurableOrchestrationQueueStore(sql);
    await seedDurableReadyJob(durable, "job-durable-stale-fence");
    const claim = await durable.claimNextAssignmentForAgent(BRIDGE_AGENT, NOW, {
      jobId: "job-durable-stale-fence",
    });
    assert.ok(claim);
    const fence = claim.lease.fenceToken;
    await durable.persistMutations();
    const reloaded = await createDurableOrchestrationQueueStore(sql);
    const { handlerDeps, backend } = bridgeClientForDurable(reloaded);
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
      { ...handlerDeps, resolveBackend: async () => backend },
    );
    assert.equal(heartbeat.status, 409);
    const active = reloaded.getMemoryStore().listAssignmentsSync().find((row) => row.id === claim.id);
    assert.equal(active?.lease.fenceToken, fence);
    assert.notEqual(active?.state, "completed");
  });

  test("interrupted polling leaves assignment incomplete and recoverable", async () => {
    setBearerEnv();
    const sql = createInMemoryOrchestrationSqlPort();
    const durable = await createDurableOrchestrationQueueStore(sql);
    await seedDurableReadyJob(durable, "job-durable-interrupted");
    const { client, store } = bridgeClientForDurable(durable);
    const transport = new FakeCursorCloudApiTransport();
    transport.configurePollsBeforeFinished(40);
    let polls = 0;
    await assert.rejects(
      () =>
        runCursorBridgeAssignmentCycle({
          bridgeEnabled: () => true,
          transport,
          config: BASE_CONFIG,
          store,
          consumer: client,
          dispatchOwnerId: OWNER,
          bearerToken: TOKEN,
          now: () => NOW,
          polling: { pollIntervalMs: 2, pollMaxDurationMs: 30_000, heartbeatMinIntervalMs: 0 },
          sleep: async (ms) => {
            polls += 1;
            await new Promise((r) => setTimeout(r, ms));
          },
          reserveExternalCreateBudget: async () => {},
          shouldAbort: () => polls >= 2,
        }),
      /polling aborted|shutdown|dispatch intent|heartbeat failed/i,
    );
    const job = store.getJobSync("job-durable-interrupted");
    assert.ok(job);
    assert.notEqual(job.state, "completed");
    const assignment = store.listAssignmentsSync().find((row) => row.jobId === "job-durable-interrupted");
    assert.ok(assignment);
    assert.notEqual(assignment.state, "completed");
    await durable.persistMutations();
    const reloaded = await createDurableOrchestrationQueueStore(sql);
    const again = reloaded.getMemoryStore().getJobSync("job-durable-interrupted");
    assert.notEqual(again?.state, "completed");
  });
});
