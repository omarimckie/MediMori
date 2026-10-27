import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { assertOfflineTestEnvironment } from "../orchestration-external-connection-guard";
import { createTestAgent, NOW } from "../test-fixtures";
import { describeCursorBridgeTests, CURSOR_BRIDGE_TEST_POLLING } from "./cursor-bridge-test-harness";
import { createCursorBridgeHarness, runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";
import { claimNextAssignmentForAgentSync } from "../agent-consumer-operations";
const TOKEN = "cursor-bridge-lifecycle-token01";
const AGENT = "cursor-bridge-lifecycle";
const OWNER = "bridge-lifecycle-owner";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

describeCursorBridgeTests("cursor-bridge-offline-lifecycle-full", () => {
  test("offline env guard rejects live Cursor key and staging database URL", () => {
    assert.equal(assertOfflineTestEnvironment({ CURSOR_API_KEY: "sk-test" }).ok, false);
    assert.equal(
      assertOfflineTestEnvironment({
        CAM_ORCHESTRATION_DATABASE_URL: "postgresql://u:p@ep-bitter-flower-b7cz1fzc-pooler/neondb",
      }).ok,
      false,
    );
    assert.equal(assertOfflineTestEnvironment({}).ok, true);
  });

  test("lifecycle: fake transport completes job and blocks duplicate claim", async () => {
    const memory = new MemoryOrchestrationQueueStore();
    memory.registerAgentSync(createTestAgent({ id: AGENT }));
    await memory.enqueueJob({
      id: "job-lifecycle-full",
      projectId: "medimori",
      goalId: "goal",
      description: "full lifecycle",
      requiredCapabilities: ["prepare_plan"],
      provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
      externalRefs: { correlationKey: "lifecycle-full" },
      now: NOW,
    });
    memory.refreshDependencyReadinessSync(NOW);
    const transport = new FakeCursorCloudApiTransport();
    let liveCalls = 0;
    const originalCreate = transport.createAgentWithInitialRun.bind(transport);
    transport.createAgentWithInitialRun = async (req) => {
      liveCalls += 1;
      return originalCreate(req);
    };
    const { client } = createCursorBridgeHarness({
      store: memory,
      config: BASE_CONFIG,
      bearerToken: TOKEN,
      now: () => NOW,
      dispatchOwnerId: OWNER,
    });
    const result = await runCursorBridgeAssignmentCycle({
      bridgeEnabled: () => true,
      transport,
      config: BASE_CONFIG,
      store: memory,
      consumer: client,
      dispatchOwnerId: OWNER,
      bearerToken: TOKEN,
      now: () => NOW,
      polling: CURSOR_BRIDGE_TEST_POLLING,
      reserveExternalCreateBudget: async () => {},
    });
    assert.ok(result);
    assert.equal(liveCalls, 1);
    assert.equal(memory.getJobSync("job-lifecycle-full")?.state, "completed");
    assert.equal(claimNextAssignmentForAgentSync(memory, AGENT, NOW), null);
  });
});
