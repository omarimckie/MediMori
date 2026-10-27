import assert from "node:assert/strict";
import test from "node:test";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { createInMemoryObjectiveSqlPort } from "./in-memory-objective-sql-port";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";
import { SupervisorContractError } from "../supervisor/types";

const NOW = "2026-10-26T23:00:00.000Z";

test("in-memory SQL port objective store persists with optimistic fence (not real PostgreSQL)", async () => {
  const sql = createInMemoryObjectiveSqlPort();
  const store = await DurableObjectiveExecutionStore.openSql(sql);
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-sql-1",
    projectId: "medimori",
    parentObjective: "SQL objective",
    now: NOW,
  });
  const { created } = store.submitIdempotent({
    plan,
    idempotencyKey: "idem-sql-1",
    now: NOW,
  });
  assert.equal(created, true);
  await store.flush();
  assert.equal(sql.tables.objectives.size, 1);

  const reloaded = await DurableObjectiveExecutionStore.openSql(sql);
  const record = reloaded.get("obj-sql-1");
  assert.ok(record);
  assert.equal(record.objectiveId, "obj-sql-1");

  const duplicate = reloaded.submitIdempotent({
    plan,
    idempotencyKey: "idem-sql-1",
    now: NOW,
  });
  assert.equal(duplicate.created, false);
});

test("SQL fence conflict fails closed", async () => {
  const sql = createInMemoryObjectiveSqlPort();
  const store = await DurableObjectiveExecutionStore.openSql(sql);
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-sql-fence",
    projectId: "medimori",
    parentObjective: "Fence",
    now: NOW,
  });
  store.submitIdempotent({ plan, idempotencyKey: "idem-fence", now: NOW });
  await store.flush();
  sql.tables.objectives.set("obj-sql-fence", {
    ...sql.tables.objectives.get("obj-sql-fence")!,
    record_fence: 99,
  });
  const record = store.get("obj-sql-fence")!;
  record.updatedAt = NOW;
  store.put(record);
  await assert.rejects(() => store.flush(), SupervisorContractError);
});
