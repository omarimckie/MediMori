import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createTestAgent, NOW } from "../test-fixtures";
import { createCursorBridgeHarness, runCursorBridgeAssignmentCycle } from "./cursor-bridge";
import { validateCursorBridgeConfig } from "./cursor-bridge-config";
import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import { CursorCloudApiError } from "./cursor-rest-errors";
import type { CursorCloudCreateAgentResult, CursorCloudRunSnapshot } from "./cursor-bridge-types";

const BRIDGE_AGENT = "cursor-bridge-agent";
const TOKEN = "cursor-bridge-token-12345678";
const OWNER_A = "bridge-owner-alpha01";

const BASE_CONFIG = validateCursorBridgeConfig({
  specialistAgentId: BRIDGE_AGENT,
  projectTargets: [{ projectId: "medimori", repoUrl: "https://github.com/example/medimori" }],
});

const FAST_POLLING = {
  pollIntervalMs: 0,
  pollMaxDurationMs: 600_000,
  heartbeatMinIntervalMs: 0,
};

class AmbiguousCreateTransport implements CursorCloudApiTransport {
  createCalls = 0;

  async createAgentWithInitialRun(): Promise<CursorCloudCreateAgentResult> {
    this.createCalls += 1;
    throw new CursorCloudApiError("Cursor API request timed out.", {
      phase: "create",
      status: null,
      ambiguousCreateOutcome: true,
    });
  }

  async getRun(): Promise<CursorCloudRunSnapshot> {
    throw new Error("not reached");
  }
}

async function seed(store: MemoryOrchestrationQueueStore, jobId: string) {
  store.registerAgentSync(createTestAgent({ id: BRIDGE_AGENT }));
  await store.enqueueJob({
    id: jobId,
    projectId: "medimori",
    goalId: "goal",
    description: "recovery job",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
}

test("ambiguous create marks outcome_unknown and blocks redispatch", async () => {
  const store = new MemoryOrchestrationQueueStore();
  await seed(store, "job-ambiguous-create");
  const transport = new AmbiguousCreateTransport();
  const { client, dispatchOwnerId } = createCursorBridgeHarness({
    store,
    config: BASE_CONFIG,
    bearerToken: TOKEN,
    now: () => NOW,
    dispatchOwnerId: OWNER_A,
  });
  await assert.rejects(
    () =>
      runCursorBridgeAssignmentCycle({
        bridgeEnabled: () => true,
        transport,
        config: BASE_CONFIG,
        store,
        consumer: client,
        dispatchOwnerId,
        polling: FAST_POLLING,
        sleep: async () => {},
        now: () => NOW,
        bearerToken: TOKEN,
      }),
    /outcome is unknown/,
  );
  assert.equal(transport.createCalls, 1);
  const assignment = store.listAssignmentsSync()[0];
  assert.equal(assignment?.cursorDispatchIntent?.state, "recovery_required");
  assert.equal(assignment?.state, "ambiguous");
  const second = await runCursorBridgeAssignmentCycle({
    bridgeEnabled: () => true,
    transport,
    config: BASE_CONFIG,
    store,
    consumer: client,
    dispatchOwnerId,
    polling: FAST_POLLING,
    sleep: async () => {},
    now: () => NOW,
    bearerToken: TOKEN,
  });
  assert.equal(second, null);
  assert.equal(transport.createCalls, 1);
});
