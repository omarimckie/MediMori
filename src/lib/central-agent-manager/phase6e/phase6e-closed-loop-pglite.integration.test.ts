import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createCamPgliteBundle } from "./cam-pglite-schema";
import { persistObjectiveThenQueue } from "./objective-queue-persist-coordinator";

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-27T11:00:00.000Z";
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

const script = {
  byTaskId: {
    "task-plan": [{ mode: "complete" as const, evidenceId: "ev-plan" }],
    "task-implement": [{ mode: "fail" as const, outcome: "recoverable_technical_failure" as const }],
    "task-qa": [
      { mode: "fail" as const, outcome: "environment_failure" as const },
      { mode: "complete" as const, evidenceId: "ev-qa-pass" },
    ],
  },
};

async function buildManager(bundle: Awaited<ReturnType<typeof createCamPgliteBundle>>) {
  const durableQueue = await createDurableOrchestrationQueueStore(bundle.orchestrationSql);
  const objectiveStore = await DurableObjectiveExecutionStore.openSql(bundle.objectiveSql);
  const manager = new DurableObjectiveQueueManager({
    store: durableQueue.getMemoryStore(),
    durableQueue,
    objectiveStore,
    objectiveSqlPort: bundle.objectiveSql,
    backends,
    now,
  });
  return { manager, durableQueue, objectiveStore };
}

test("PGlite closed loop: submit through QA accept, restart, final owner report", async () => {
  const bundle = await createCamPgliteBundle();
  let { manager, durableQueue, objectiveStore } = await buildManager(bundle);
  manager.bootstrapAgents();

  const submitted = manager.submitObjective({
    objectiveId: "obj-6e-pg",
    parentObjective: "Ship PG feature",
    projectId: "medimori",
    idempotencyKey: "submit-6e-pg",
  });
  assert.equal(submitted.created, true);
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });

  let finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "obj-6e-pg",
    script,
    maxPasses: 120,
  });
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });

  assert.ok(finalRecord.closedLoop.followUpTasksCreated >= 1);

  ({ manager, durableQueue, objectiveStore } = await buildManager(bundle));
  manager.bootstrapAgents();
  finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "obj-6e-pg",
    script: {
      byTaskId: {
        "task-qa": [{ mode: "complete" as const, evidenceId: "ev-qa-pass-2" }],
      },
    },
    maxPasses: 80,
  });
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });

  if (finalRecord.lifecycleState !== "completed") {
    finalRecord = await manager.runFakeWorkersForObjective({
      objectiveId: "obj-6e-pg",
      script,
      maxPasses: 120,
    });
  }
  assert.equal(finalRecord.lifecycleState, "completed");

  const report = await manager.persistFinalOwnerReport("obj-6e-pg");
  assert.equal(report.objectiveStatus, "completed");
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });

  const restarted = await buildManager(bundle);
  const status = restarted.manager.reconstructOwnerStatus("obj-6e-pg");
  assert.equal(status.persistedSnapshot?.objectiveStatus, "completed");
  assert.ok(status.recordFence !== null && status.recordFence! > 0);
});
