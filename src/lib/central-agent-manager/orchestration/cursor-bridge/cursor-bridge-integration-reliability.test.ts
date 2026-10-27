import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_BRIDGE_TEST_POLLING, describeCursorBridgeTests } from "./cursor-bridge-test-harness";
import { centralAgentManagerDispatchRecoveryResponse } from "../../dispatch-recovery-handler";
import { claimNextAssignmentForAgentSync } from "../agent-consumer-operations";
import { requireDispatchRecoverySync } from "../cursor-dispatch-intent";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createTestAgent, NOW } from "../test-fixtures";
import { createCursorBridgeHarness, runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

const TOKEN = "cursor-bridge-token-12345678";
const BRIDGE_AGENT = "cursor-bridge-agent";
const OWNER = "bridge-owner-alpha01";
const RECOVERY_OWNER = "owner-alpha";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

describeCursorBridgeTests("cursor-bridge-integration-reliability", () => {

async function seed(store: MemoryOrchestrationQueueStore, jobId: string) {
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal",
    description: "integration reliability job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  store.refreshDependencyReadinessSync(NOW);
  const job = store.getJobSync(jobId);
  assert.equal(job?.state, "ready", "seeded job must be ready before claim");
}

test("owner recovery confirm enables poll-only resume without second create", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-owner-poll-resume");
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const claimed = claimNextAssignmentForAgentSync(store, BRIDGE_AGENT, NOW);
  assert.ok(claimed, "expected claimable assignment before recovery scenario");
  const assignmentId = claimed.id;
  const fenceToken = claimed.lease.fenceToken;
  requireDispatchRecoverySync(
    store,
    BRIDGE_AGENT,
    assignmentId,
    fenceToken,
    NOW,
    "Simulated ambiguous network response.",
  );
  const transport = new FakeCursorCloudApiTransport();
  transport.runs.set("bc-resume-00000001:run-resume-00000001", {
    request: { promptText: "x", repoUrl: "https://github.com/example/medimori" },
    status: "FINISHED",
    artifactPath: "artifacts/cursor-bridge/outcome.json",
  });
  const confirm = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "confirm_verified_external_ids",
        assignmentId,
        auditId: "audit-poll-resume01",
        externalRefs: {
          cursorAgentId: "bc-resume-00000001",
          cursorRunId: "run-resume-00000001",
        },
      }),
    }),
    {
      isEnabled: () => true,
      isOwnerConfigured: () => true,
      recoveryEnabled: () => true,
      isOwner: (u) => u === RECOVERY_OWNER,
      getUsername: async () => RECOVERY_OWNER,
      resolveStore: async () => store,
      now: () => NOW,
    },
  );
  assert.equal(confirm.status, 200);
  assert.equal(transport.createCallCount, 0);
  const result = await runCursorBridgeAssignmentCycle({
    bridgeEnabled: () => true,
    transport,
    config: BASE_CONFIG,
    store,
    consumer: client,
    dispatchOwnerId: OWNER,
    polling: CURSOR_BRIDGE_TEST_POLLING,
    sleep: async () => {},
    now: () => NOW,
    bearerToken: TOKEN,
  });
  assert.ok(result);
  assert.equal(result?.externalCreatePerformed, false);
  assert.equal(transport.createCallCount, 0);
  assert.equal(store.getJobSync("job-owner-poll-resume")?.state, "completed");
});

test("protected approval-required job remains unclaimable by bridge", async () => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: "job-protected-bridge",
    projectId: "medimori",
    goalId: "goal",
    description: "protected",
    requiredCapabilities: ["prepare_plan"],
    requestedOperation: "production_deploy",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const { client } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER,
  });
  const result = await runCursorBridgeAssignmentCycle({
    bridgeEnabled: () => true,
    transport: new FakeCursorCloudApiTransport(),
    config: BASE_CONFIG,
    store,
    consumer: client,
    dispatchOwnerId: OWNER,
    polling: CURSOR_BRIDGE_TEST_POLLING,
    sleep: async () => {},
    now: () => NOW,
    bearerToken: TOKEN,
  });
  assert.equal(result, null);
});
});
