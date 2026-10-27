/**
 * Bounded manager-controlled fake-worker workflow (no live API / external DB).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCamPgliteBundle } from "../src/lib/central-agent-manager/phase6e/cam-pglite-schema";
import { createDurableOrchestrationQueueStore } from "../src/lib/central-agent-manager/orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../src/lib/central-agent-manager/phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../src/lib/central-agent-manager/phase6c/durable-objective-queue-manager";
import { persistObjectiveThenQueue } from "../src/lib/central-agent-manager/phase6e/objective-queue-persist-coordinator";

const backends = [
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

async function main(): Promise<void> {
  if (process.env.CAM_NUC13_FAKE_WORKER_DEMO !== "1") {
    console.log(JSON.stringify({ ok: false, code: "demo_disabled" }));
    process.exitCode = 1;
    return;
  }
  process.env.CURSOR_API_KEY = "";
  delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), "cam-fake-worker-demo-"));
  const stopFile = join(dir, "emergency-stop");
  let tick = 0;
  const NOW = "2026-10-27T15:00:00.000Z";
  const now = () => {
    tick += 1;
    return new Date(Date.parse(NOW) + tick * 1000).toISOString();
  };
  const transitions: string[] = [];
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
    backends,
    now,
  });
  manager.bootstrapAgents();
  transitions.push("manager_bootstrapped");
  manager.submitObjective({
    objectiveId: "demo-obj",
    parentObjective: "NUC13 fake worker demo",
    projectId: "medimori",
    idempotencyKey: "demo-submit",
  });
  transitions.push("objective_submitted");
  const script = {
    byTaskId: {
      "task-plan": [{ mode: "complete" as const, evidenceId: "ev-plan" }],
      "task-implement": [{ mode: "complete" as const, evidenceId: "ev-impl" }],
      "task-qa": [{ mode: "complete" as const, evidenceId: "ev-qa" }],
    },
  };
  const finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "demo-obj",
    script,
    maxPasses: 60,
  });
  transitions.push(`lifecycle_${finalRecord.lifecycleState}`);
  await persistObjectiveThenQueue(bundle.client, {
    objectiveStore: objectiveStore as DurableObjectiveExecutionStore,
    durableQueue,
  });
  const report = await manager.persistFinalOwnerReport("demo-obj");
  transitions.push(`report_${report.objectiveStatus}`);
  await rm(dir, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      ok: true,
      code: "fake_worker_workflow_demo",
      transitions,
      emergencyStop: stopFile,
      rollback: "Unset CAM_NUC13_FAKE_WORKER_DEMO; discard PGlite in-process state.",
      mockTransport: true,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
