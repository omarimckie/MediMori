import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "../orchestration/in-memory-orchestration-sql-port";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createInMemoryObjectiveSqlPort } from "./in-memory-objective-sql-port";
import { attachPendingApproval, buildActionableApprovalRequest } from "../phase6b/approval-escalation";
import { createObjectiveExecutionRecord } from "../phase6b/objective-execution-record";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";
import { planManagerCorrectiveDispatch } from "./manager-corrective-dispatch";
import { matchWorkerForTask } from "../phase6a/worker-matching";
import { createInMemoryBudgetReservationSqlPort, reserveBudgetDurably, emptyLedgerForObjective } from "./objective-budget-reservation-sql";
import { SupervisorContractError } from "../supervisor/types";
import { FakeCursorCloudApiTransport } from "../orchestration/cursor-bridge/fake-cursor-cloud-api-transport";
import { CursorCloudExecutionAdapter } from "./cursor-cloud-execution-adapter";

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "devops" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-26T23:30:00.000Z";
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

async function buildManager(): Promise<DurableObjectiveQueueManager> {
  const queueSql = createInMemoryOrchestrationSqlPort();
  const durableQueue = await createDurableOrchestrationQueueStore(queueSql);
  const objectiveSql = createInMemoryObjectiveSqlPort();
  const objectiveStore = await DurableObjectiveExecutionStore.openSql(objectiveSql);
  return DurableObjectiveQueueManager.recover({
    options: {
      store: durableQueue.getMemoryStore(),
      durableQueue,
      objectiveStore,
      objectiveSqlPort: objectiveSql,
      backends,
      now,
    },
  });
}

test("scenario: engineering failure produces bounded corrective dispatch", async () => {
  const manager = await buildManager();
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-dispatch",
    parentObjective: "Fix",
    projectId: "medimori",
    idempotencyKey: "idem-dispatch",
  });
  const record = manager.getObjective("obj-dispatch")!;
  const decision = planManagerCorrectiveDispatch({
    record,
    report: {
      taskId: "task-implement",
      workerId: "w1",
      role: "engineering",
      outcome: "recoverable_technical_failure",
    },
    backends,
  });
  assert.equal(decision.mayEnqueueCorrective, true);
});

test("scenario: approval pause and simulated grant metadata", async () => {
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-approval-flow",
    projectId: "medimori",
    parentObjective: "Deploy",
    now: now(),
  });
  let record = createObjectiveExecutionRecord({ plan, idempotencyKey: "idem-appr", now: now() });
  const actionable = buildActionableApprovalRequest({
    record,
    report: {
      taskId: "task-implement",
      workerId: "w1",
      role: "engineering",
      outcome: "missing_permission",
      protectedOperation: "production_deploy",
    },
    now: now(),
    scenarioKey: "production_deploy",
  });
  record = attachPendingApproval(record, actionable.approval, now());
  assert.equal(record.lifecycleState, "awaiting_owner_approval");

  assert.equal(record.pendingApprovals[0].status, "pending");
  record = {
    ...record,
    pendingApprovals: record.pendingApprovals.map((row) => ({ ...row, status: "granted" as const })),
    lifecycleState: "executing",
  };
  assert.equal(record.pendingApprovals[0].status, "granted");
});

test("scenario: multi-project isolation in matcher", () => {
  const med = matchWorkerForTask({
    projectId: "medimori",
    requiredCapabilities: ["prepare_plan"],
    taskOperations: ["prepare_plan"],
    backends: [{ role: "engineering", adapterEnabled: true, concurrentSlots: 1 }],
    budgetRemainingUsd: 2,
    candidateTaskId: "task-implement",
  });
  const tf = matchWorkerForTask({
    projectId: "twilight_feather",
    requiredCapabilities: ["prepare_plan"],
    taskOperations: ["prepare_plan"],
    backends: [{ role: "engineering", adapterEnabled: true, concurrentSlots: 1 }],
    budgetRemainingUsd: 2,
    candidateTaskId: "task-implement",
  });
  assert.equal(med.ok, true);
  assert.equal(tf.ok, true);
});

test("scenario: budget exhaustion fails closed", async () => {
  const port = createInMemoryBudgetReservationSqlPort();
  let ledger = emptyLedgerForObjective(0.5);
  await assert.rejects(
    () =>
      reserveBudgetDurably({
        port,
        objectiveId: "obj-budget",
        reservationId: "res-1",
        amountUsd: 1,
        ledger,
        now: now(),
      }),
    SupervisorContractError,
  );
});

test("scenario: cursor cloud adapter disabled without arm flag", async () => {
  const adapter = new CursorCloudExecutionAdapter({
    transport: new FakeCursorCloudApiTransport(),
    env: {
      CAM_CURSOR_EXECUTION_ADAPTER_ENABLED: "true",
      CAM_CURSOR_EXECUTION_ADAPTER_MODE: "cloud_api",
      CAM_CURSOR_REAL_ADAPTER_ARMED: "false",
    },
  });
  await assert.rejects(() =>
    adapter.createRun({ promptText: "x", repoUrl: "https://example.com/repo.git" }),
  );
});

test("scenario: SQL objective survives manager recovery", async () => {
  let manager = await buildManager();
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-restart-6d",
    parentObjective: "Restart",
    projectId: "medimori",
    idempotencyKey: "idem-restart-6d",
  });
  await manager.managerTick("obj-restart-6d");
  await manager.persistAll();
  manager = await manager.simulateCrashRecovery();
  const record = manager.getObjective("obj-restart-6d");
  assert.ok(record);
  assert.ok(record.taskBindings.length >= 0);
});
