import assert from "node:assert/strict";
import test from "node:test";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";
import { SupervisorContractError } from "../supervisor/types";
import { createCamPgliteBundle } from "./cam-pglite-schema";

const NOW = "2026-10-27T10:00:00.000Z";

test("PGlite PostgreSQL objective store persists and reloads with fence", async () => {
  const { objectiveSql } = await createCamPgliteBundle();
  const store = await DurableObjectiveExecutionStore.openSql(objectiveSql);
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-pg-real",
    projectId: "medimori",
    parentObjective: "Ship",
    now: NOW,
  });
  store.submitIdempotent({ plan, idempotencyKey: "idem-pg", now: NOW });
  await store.flush();
  const reloaded = await DurableObjectiveExecutionStore.openSql(objectiveSql);
  const row = reloaded.get("obj-pg-real");
  assert.ok(row);
  assert.equal(row.idempotencyKey, "idem-pg");
});

test("PGlite PostgreSQL objective fence conflict fails closed", async () => {
  const { objectiveSql } = await createCamPgliteBundle();
  const store = await DurableObjectiveExecutionStore.openSql(objectiveSql);
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-fence-pg",
    projectId: "medimori",
    parentObjective: "Fence",
    now: NOW,
  });
  const { record } = store.submitIdempotent({ plan, idempotencyKey: "idem-fence", now: NOW });
  await store.flush();
  store.put({ ...record, updatedAt: NOW });
  const stale = await DurableObjectiveExecutionStore.openSql(objectiveSql);
  const staleRow = stale.get("obj-fence-pg")!;
  stale.put({ ...staleRow, updatedAt: NOW });
  await stale.flush();
  await assert.rejects(() => store.flush(), SupervisorContractError);
});
