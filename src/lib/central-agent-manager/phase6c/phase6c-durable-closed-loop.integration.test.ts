import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "../orchestration/in-memory-orchestration-sql-port";
import { DurableObjectiveExecutionStore } from "./durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "./durable-objective-queue-manager";
import {
  createPhase6bMockClients,
  resetFakeWorkerScriptCounters,
  runFakeWorkerForActiveAssignment,
} from "../phase6b/fake-queue-worker";
import { findBindingForJob } from "../phase6b/objective-execution-record";

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-26T22:00:00.000Z";
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

async function runActiveFakeWorkers(manager: DurableObjectiveQueueManager, objectiveId: string): Promise<void> {
  const record = manager.getObjective(objectiveId);
  if (!record) return;
  const clients = createPhase6bMockClients({
    store: manager.memoryStore,
    now,
    bearerByRole: {
      research_planning: "token-research",
      engineering: "token-eng",
      qa_independent_review: "token-qa",
      devops: "token-devops",
    },
  });
  const active = manager.memoryStore.listAssignmentsSync().filter((a) => a.state === "active");
  for (const assignment of active) {
    const binding = findBindingForJob(record, assignment.jobId);
    if (!binding) continue;
    const role = binding.specialistRole as
      | "engineering"
      | "qa_independent_review"
      | "research_planning"
      | "devops";
    const client = clients.get(role);
    if (!client) continue;
    await runFakeWorkerForActiveAssignment({
      store: manager.memoryStore,
      client,
      role,
      taskId: binding.taskId,
      jobId: assignment.jobId,
      script,
      now: now(),
    });
  }
}

async function driveUntil(
  manager: DurableObjectiveQueueManager,
  objectiveId: string,
  predicate: () => boolean,
  maxPasses = 80,
): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (predicate()) return;
    await manager.managerTick(objectiveId);
    await runActiveFakeWorkers(manager, objectiveId);
    await manager.managerTick(objectiveId);
    await manager.persistAll();
  }
}

test("durable closed loop survives two restarts without duplicate outcomes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-6c-"));
  const objectivePath = join(dir, "objectives.json");
  const sql = createInMemoryOrchestrationSqlPort();
  const durableQueue = await createDurableOrchestrationQueueStore(sql);
  const objectiveStore = await DurableObjectiveExecutionStore.open(objectivePath);

  let manager = await DurableObjectiveQueueManager.recover({
    options: {
      store: durableQueue.getMemoryStore(),
      durableQueue,
      objectiveStore,
      backends,
      now,
    },
  });
  manager.bootstrapAgents();
  resetFakeWorkerScriptCounters();

  const { created } = manager.submitObjective({
    objectiveId: "obj-6c-durable",
    parentObjective: "Durable feature",
    projectId: "medimori",
    idempotencyKey: "idem-6c-durable",
  });
  assert.equal(created, true);
  manager.reserveBudgetForTask("obj-6c-durable");

  await driveUntil(manager, "obj-6c-durable", () => {
    const record = manager.getObjective("obj-6c-durable");
    return Boolean(record?.closedLoop.followUpTasksCreated);
  });

  manager = await manager.simulateCrashRecovery();
  await driveUntil(manager, "obj-6c-durable", () => {
    const record = manager.getObjective("obj-6c-durable");
    const implement = record?.closedLoop.plan.tasks.find((t) => t.id === "task-implement");
    return implement?.state === "completed";
  });

  manager = await manager.simulateCrashRecovery();
  await driveUntil(manager, "obj-6c-durable", () => manager.getObjective("obj-6c-durable")?.lifecycleState === "completed", 120);

  const finalRecord = manager.getObjective("obj-6c-durable");
  assert.equal(finalRecord?.lifecycleState, "completed");
  const bindings = finalRecord?.taskBindings ?? [];
  const jobIds = new Set(bindings.map((b) => b.jobId));
  assert.equal(jobIds.size, bindings.length);

  const accepted = manager.objectiveStore.getAcceptedOutcomeKeys("obj-6c-durable");
  const uniqueAccepted = new Set(accepted);
  assert.equal(uniqueAccepted.size, accepted.length);

  const report = await manager.persistFinalOwnerReport("obj-6c-durable");
  assert.equal(report.objectiveStatus, "completed");

  manager = await manager.simulateCrashRecovery();
  const reconstructed = manager.reconstructOwnerStatus("obj-6c-durable");
  assert.equal(reconstructed.persistedSnapshot?.objectiveStatus, "completed");
  assert.ok(reconstructed.budgetLedger);

  await rm(dir, { recursive: true, force: true });
});
