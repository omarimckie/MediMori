import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createCamPgliteBundle } from "../phase6e/cam-pglite-schema";

const backends = [{ role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 }];
let tick = 0;
const NOW = "2026-10-27T19:00:00.000Z";
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

test("accepted outcome keys survive objective SQL reload", async () => {
  const bundle = await createCamPgliteBundle();
  const objectiveStore = await DurableObjectiveExecutionStore.openSql(bundle.objectiveSql);
  const plan = (await import("../phase6a/objective-plan")).offlineObjectivePlanner.createPlan({
    objectiveId: "obj-crash-outcome",
    projectId: "medimori",
    parentObjective: "Crash",
    now: NOW,
  });
  objectiveStore.submitIdempotent({ plan, idempotencyKey: "idem-crash-outcome", now: NOW });
  await objectiveStore.flush();
  const key = "job:job-1:completed";
  objectiveStore.markOutcomeAccepted("obj-crash-outcome", key);
  await objectiveStore.flush();
  await objectiveStore.reloadFromBackend();
  assert.ok(objectiveStore.getAcceptedOutcomeKeys("obj-crash-outcome").includes(key));
});

test("budget reserved then manager restart keeps reservation row", async () => {
  const bundle = await createCamPgliteBundle();
  await bundle.budgetSql.ensureBudgetCap("obj-crash-budget", 2);
  await bundle.budgetSql.tryReserveWithCap({
    objectiveId: "obj-crash-budget",
    reservationId: "dispatch:obj-crash-budget:task-implement:1",
    amountUsd: 0.25,
    now: NOW,
  });
  const rows = await bundle.budgetSql.listReservations("obj-crash-budget");
  assert.equal(rows.filter((r) => r.status === "reserved").length, 1);
});
