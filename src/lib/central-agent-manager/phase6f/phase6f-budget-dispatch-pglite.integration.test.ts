import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createCamPgliteBundle } from "../phase6e/cam-pglite-schema";

const backends = [
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-27T14:00:00.000Z";
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

test("PGlite manager blocks billable dispatch when durable cap exhausted", async () => {
  const bundle = await createCamPgliteBundle();
  const durableQueue = await createDurableOrchestrationQueueStore(bundle.orchestrationSql);
  const objectiveStore = await DurableObjectiveExecutionStore.openSql(bundle.objectiveSql);
  const manager = new DurableObjectiveQueueManager({
    store: durableQueue.getMemoryStore(),
    durableQueue,
    objectiveStore,
    objectiveSqlPort: bundle.objectiveSql,
    budgetReservationPort: bundle.budgetSql,
    requireSqlBudgetForBillableDispatch: true,
    taskReservationUsd: 0.6,
    backends,
    now,
  });
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-budget-dispatch",
    parentObjective: "Cap test",
    projectId: "medimori",
    idempotencyKey: "idem-budget-dispatch",
  });
  await bundle.budgetSql.ensureBudgetCap("obj-budget-dispatch", 0.5);
  await manager.managerTick("obj-budget-dispatch");
  const record = manager.getObjective("obj-budget-dispatch")!;
  const enqueued = record.taskBindings.length;
  assert.equal(enqueued, 0);
});

test("PGlite duplicate dispatch reservation is idempotent", async () => {
  const bundle = await createCamPgliteBundle();
  await bundle.budgetSql.ensureBudgetCap("obj-dup", 2);
  const ok1 = await bundle.budgetSql.tryReserveWithCap({
    objectiveId: "obj-dup",
    reservationId: "dispatch:obj-dup:task-implement:1",
    amountUsd: 0.25,
    now: NOW,
  });
  const ok2 = await bundle.budgetSql.tryReserveWithCap({
    objectiveId: "obj-dup",
    reservationId: "dispatch:obj-dup:task-implement:1",
    amountUsd: 0.25,
    now: NOW,
  });
  assert.equal(ok1, true);
  assert.equal(ok2, false);
});
