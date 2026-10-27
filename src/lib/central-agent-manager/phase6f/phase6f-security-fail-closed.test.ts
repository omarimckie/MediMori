import assert from "node:assert/strict";
import test from "node:test";
import { createSqlBillableDispatchGate } from "./billable-dispatch-budget-gate";
import { createInMemoryBudgetReservationSqlPort } from "../phase6d/objective-budget-reservation-sql";
import { createMemoryDurableObjectiveStore } from "../phase6c/durable-objective-execution-store";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";
import { assertPathWithinProjectWorkspace, projectWorkspaceRoot } from "../phase6e/project-workspace-guard";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SupervisorContractError } from "../supervisor/types";

test("missing SQL cap helpers blocks billable dispatch", async () => {
  const store = createMemoryDurableObjectiveStore();
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-sec",
    projectId: "medimori",
    parentObjective: "x",
    now: "2026-10-27T16:00:00.000Z",
  });
  store.submitIdempotent({ plan, idempotencyKey: "k", now: "2026-10-27T16:00:00.000Z" });
  const gate = createSqlBillableDispatchGate({
    budgetPort: createInMemoryBudgetReservationSqlPort(),
    objectiveStore: store,
    now: () => "2026-10-27T16:00:00.000Z",
    requireSqlCap: true,
  });
  await assert.rejects(
    () =>
      gate({
        objectiveId: "obj-sec",
        taskId: "task-implement",
        jobId: "job-1",
        attemptNumber: 1,
        role: "engineering",
        amountUsd: 0.25,
      }),
    SupervisorContractError,
  );
});

test("cross-project path traversal blocked", () => {
  const base = mkdtempSync(join(tmpdir(), "cam-sec-"));
  const medRoot = projectWorkspaceRoot("medimori", base);
  mkdirSync(medRoot, { recursive: true });
  assert.throws(() => assertPathWithinProjectWorkspace(medRoot, join(medRoot, "..", "twilight_feather", "x")));
});
