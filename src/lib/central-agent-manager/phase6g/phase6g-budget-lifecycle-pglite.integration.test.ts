import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createCamPgliteBundle } from "../phase6e/cam-pglite-schema";
import { fromBudgetMinor, toBudgetMinor } from "./budget-minor-units";

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-27T17:00:00.000Z";
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

test("PGlite budget lifecycle: reserve on dispatch, consume on completion", async () => {
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
    taskReservationUsd: 0.25,
    backends,
    now,
  });
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-budget-life",
    parentObjective: "Lifecycle",
    projectId: "medimori",
    idempotencyKey: "idem-budget-life",
  });
  const finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "obj-budget-life",
    script: {
      byTaskId: {
        "task-plan": [{ mode: "complete" as const, evidenceId: "ev-plan" }],
        "task-implement": [{ mode: "complete" as const, evidenceId: "ev-impl" }],
      },
    },
    maxPasses: 80,
  });
  assert.ok(finalRecord.taskBindings.length >= 1);
  const reservations = await bundle.budgetSql.listReservations("obj-budget-life");
  const consumed = reservations.filter((r) => r.status === "consumed");
  assert.ok(consumed.length >= 1);
  const caps = await bundle.client.query(
    `SELECT reserved_usd::float8 AS reserved_usd, consumed_usd::float8 AS consumed_usd
     FROM central_agent_manager.objective_budget_caps WHERE objective_id = $1`,
    ["obj-budget-life"],
  );
  assert.ok(caps.rows.length === 1);
  assert.equal(toBudgetMinor(Number(caps.rows[0].consumed_usd)), toBudgetMinor(0.25));
});

test("minor unit helpers are exact for quarter-dollar increments", () => {
  assert.equal(fromBudgetMinor(toBudgetMinor(0.25)), 0.25);
});
