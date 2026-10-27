import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import { ObjectiveQueueManager } from "./objective-queue-manager";

const NOW = "2026-10-26T20:30:00.000Z";
let tick = 0;
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "devops" as const, adapterEnabled: true, concurrentSlots: 1 },
];

test("queue-backed engineering → QA → correction → owner report", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const manager = new ObjectiveQueueManager({ store, backends, now });
  manager.bootstrapAgents();

  const { created } = manager.submitObjective({
    objectiveId: "obj-6b-e2e",
    parentObjective: "Ship offline feature",
    projectId: "medimori",
    idempotencyKey: "submit-6b-e2e",
  });
  assert.equal(created, true);

  const duplicate = manager.submitObjective({
    objectiveId: "obj-6b-e2e",
    parentObjective: "Ship offline feature",
    projectId: "medimori",
    idempotencyKey: "submit-6b-e2e",
  });
  assert.equal(duplicate.created, false);

  const finalRecord = await manager.runFakeWorkersForObjective({
    objectiveId: "obj-6b-e2e",
    script: {
      byTaskId: {
        "task-plan": [{ mode: "complete", evidenceId: "ev-plan" }],
        "task-implement": [{ mode: "fail", outcome: "recoverable_technical_failure" }],
        "task-qa": [
          { mode: "fail", outcome: "environment_failure" },
          { mode: "complete", evidenceId: "ev-qa-pass" },
        ],
      },
    },
    maxPasses: 120,
  });

  assert.equal(finalRecord.lifecycleState, "completed");
  assert.ok(finalRecord.closedLoop.followUpTasksCreated >= 1);
  const report = manager.buildOwnerReport("obj-6b-e2e");
  assert.equal(report.objectiveStatus, "completed");
  assert.ok(report.completedTasks.includes("task-qa"));
  assert.ok(report.finalOutcome);
  assert.ok(report.queueBindings.length >= 4);
});

test("objective execution store survives restart snapshot", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const manager = new ObjectiveQueueManager({ store, backends, now });
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-restart",
    parentObjective: "Restart path",
    projectId: "medimori",
    idempotencyKey: "idem-restart",
  });
  await manager.managerTick("obj-restart");
  const snapshot = manager.persistObjectiveStoreSnapshot();
  const manager2 = new ObjectiveQueueManager({ store, backends, now });
  manager2.restoreObjectiveStoreSnapshot(snapshot);
  const restored = manager2.getObjective("obj-restart");
  assert.ok(restored);
  assert.equal(restored.objectiveId, "obj-restart");
  assert.ok(restored.taskBindings.length >= 0);
});
