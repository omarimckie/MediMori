import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "../in-memory-orchestration-sql-port";
import { createDurableAgentConsumerBackend } from "../queue-store-factory";
import { createTestAgent, NOW } from "../test-fixtures";
import { createMockSpecialistHarness } from "../mock-specialist-agent";
import { CursorBridgeConsumerClient } from "./cursor-bridge-consumer-client";
import { runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { CURSOR_BRIDGE_TEST_POLLING, describeCursorBridgeTests } from "./cursor-bridge-test-harness";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";
import { claimNextAssignmentForAgentSync } from "../agent-consumer-operations";

const BRIDGE_AGENT = "cursor-bridge-prod-contract";
const TOKEN = "cursor-bridge-prod-contract-token12";
const OWNER = "bridge-prod-contract-owner";

function setBearerEnv() {
  process.env.CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON = JSON.stringify([
    { agentId: BRIDGE_AGENT, token: TOKEN },
  ]);
}

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

describeCursorBridgeTests("cursor-bridge-durable-production-contract", () => {
  test("claim, begin, heartbeat, evidence, and complete persist through reload without harness stubs", async () => {
    setBearerEnv();
    const sql = createInMemoryOrchestrationSqlPort();
    const durable = await createDurableOrchestrationQueueStore(sql);
    const memory = durable.getMemoryStore();
    memory.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
    await durable.enqueueJob({
      id: "job-prod-contract",
      projectId: "medimori",
      goalId: "goal-prod",
      description: "production durable contract",
      requiredCapabilities: ["prepare_plan"],
      provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
      now: NOW,
    });
    memory.refreshDependencyReadinessSync(NOW);
    await durable.persistMutations();

    const backend = createDurableAgentConsumerBackend(durable);
    const { handlerDeps } = createMockSpecialistHarness({
      store: memory,
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

    const transport = new FakeCursorCloudApiTransport();
    const result = await runCursorBridgeAssignmentCycle({
      bridgeEnabled: () => true,
      transport,
      config: BASE_CONFIG,
      store: memory,
      liveStore: () => durable.getMemoryStore(),
      consumer: client,
      dispatchOwnerId: OWNER,
      bearerToken: TOKEN,
      now: () => NOW,
      polling: CURSOR_BRIDGE_TEST_POLLING,
      reserveExternalCreateBudget: async () => {},
    });
    assert.ok(result);
    assert.equal(result.jobState, "completed");
    assert.equal(durable.getMemoryStore().getJobSync("job-prod-contract")?.state, "completed");
    const sqlPort = sql as ReturnType<typeof createInMemoryOrchestrationSqlPort> & {
      tables: { jobs: Map<string, { payload_json: string }> };
    };
    const persistedJob = sqlPort.tables.jobs.get("job-prod-contract");
    assert.ok(persistedJob, "job row must exist in SQL after bridge cycle");
    assert.equal(JSON.parse(persistedJob.payload_json).state, "completed");

    const reloaded = await createDurableOrchestrationQueueStore(sql);
    assert.equal(reloaded.getMemoryStore().getJobSync("job-prod-contract")?.state, "completed");
    assert.equal(claimNextAssignmentForAgentSync(reloaded.getMemoryStore(), BRIDGE_AGENT, NOW), null);
  });
});
