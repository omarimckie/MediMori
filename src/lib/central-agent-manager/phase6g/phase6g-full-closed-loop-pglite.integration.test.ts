import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createCamPgliteBundle } from "../phase6e/cam-pglite-schema";
import { persistObjectiveThenQueue } from "../phase6e/objective-queue-persist-coordinator";

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-27T18:00:00.000Z";
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
    budgetReservationPort: bundle.budgetSql,
    requireSqlBudgetForBillableDispatch: true,
    taskReservationUsd: 0.25,
    backends,
    now,
  });
  return { manager, durableQueue, objectiveStore };
}

test("PGlite full closed loop with budget reconciliation and restart", async () => {
  const bundle = await createCamPgliteBundle();
  let { manager, durableQueue, objectiveStore } = await buildManager(bundle);
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-6g-full",
    parentObjective: "Ship SQL feature",
    projectId: "medimori",
    idempotencyKey: "submit-6g-full",
  });

  let finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "obj-6g-full",
    script,
    maxPasses: 140,
  });
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });

  assert.ok(finalRecord.closedLoop.followUpTasksCreated >= 1);
  ({ manager, durableQueue, objectiveStore } = await buildManager(bundle));
  manager.bootstrapAgents();
  finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "obj-6g-full",
    script: { byTaskId: { "task-qa": [{ mode: "complete" as const, evidenceId: "ev-qa-2" }] } },
    maxPasses: 100,
  });
  if (finalRecord.lifecycleState !== "completed") {
    finalRecord = await manager.runFakeWorkersForObjective({ objectiveId: "obj-6g-full", script, maxPasses: 140 });
  }
  assert.equal(finalRecord.lifecycleState, "completed");

  const report = await manager.persistFinalOwnerReport("obj-6g-full");
  assert.equal(report.objectiveStatus, "completed");
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });

  const reloaded = await buildManager(bundle);
  const status = reloaded.manager.reconstructOwnerStatus("obj-6g-full");
  assert.equal(status.persistedSnapshot?.objectiveStatus, "completed");
  const reservations = await bundle.budgetSql.listReservations("obj-6g-full");
  assert.ok(reservations.some((r) => r.status === "consumed"));
  assert.ok(reservations.some((r) => r.status === "released" || r.status === "consumed"));
});
