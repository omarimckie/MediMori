import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createTestAgent, NOW } from "../test-fixtures";
import { CURSOR_BRIDGE_TEST_POLLING, describeCursorBridgeTests } from "./cursor-bridge-test-harness";
import { createCursorBridgeHarness, runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

const TOKEN = "cursor-bridge-offline-e2e-token01";
const BRIDGE_AGENT = "cursor-bridge-offline-e2e";
const DISPATCH_OWNER = "bridge-offline-e2e-owner";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

async function seedReadyJob(store: MemoryOrchestrationQueueStore, jobId: string) {
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal-offline-e2e",
    description: "offline fake transport e2e",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    externalRefs: { correlationKey: "offline-e2e" },
    now: NOW,
  });
  store.refreshDependencyReadinessSync(NOW);
}

describeCursorBridgeTests("cursor-bridge-offline-e2e-lifecycle", () => {
  test("fake transport completes assignment without live Cursor API", async () => {
    const store = new MemoryOrchestrationQueueStore();
    await seedReadyJob(store, "job-offline-e2e-fake");
    const transport = new FakeCursorCloudApiTransport();
    let createCalls = 0;
    const originalCreate = transport.createAgentWithInitialRun.bind(transport);
    transport.createAgentWithInitialRun = async (request) => {
      createCalls += 1;
      return originalCreate(request);
    };
    const { client } = createCursorBridgeHarness({
      store,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: DISPATCH_OWNER,
    });
    const result = await runCursorBridgeAssignmentCycle({
      bridgeEnabled: () => true,
      transport,
      config: BASE_CONFIG,
      store,
      consumer: client,
      dispatchOwnerId: DISPATCH_OWNER,
      bearerToken: TOKEN,
      now: () => NOW,
      polling: CURSOR_BRIDGE_TEST_POLLING,
      reserveExternalCreateBudget: async () => {},
    });
    assert.ok(result);
    assert.equal(result.jobState, "completed");
    assert.equal(createCalls, 1);
    assert.equal(store.getJobSync("job-offline-e2e-fake")?.state, "completed");
    assert.equal(createCalls, 1);
  });
});
