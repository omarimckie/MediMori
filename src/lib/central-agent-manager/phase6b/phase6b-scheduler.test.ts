import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";
import { createObjectiveExecutionRecord } from "./objective-execution-record";
import { scheduleEligiblePlanTasks } from "./plan-to-queue-scheduler";
import { registerPhase6bAgents } from "./queue-agent-registry";

const NOW = "2026-10-26T20:00:00.000Z";

const backends = [
  { role: "research_planning" as const, adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

test("plan-to-queue scheduler is idempotent for duplicate passes", async () => {
  const store = new MemoryOrchestrationQueueStore();
  registerPhase6bAgents(store, NOW);
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-dedupe",
    projectId: "medimori",
    parentObjective: "Dedupe test",
    now: NOW,
  });
  const tasks = plan.tasks.map((t) => (t.id === "task-plan" ? { ...t, state: "ready" as const } : t));
  let record = createObjectiveExecutionRecord({
    plan: { ...plan, tasks },
    idempotencyKey: "idem-1",
    now: NOW,
    maxConcurrentTasks: 2,
  });
  record.lifecycleState = "executing";

  const first = await scheduleEligiblePlanTasks({ store, record, backends, now: NOW });
  const second = await scheduleEligiblePlanTasks({
    store,
    record: first.record,
    backends,
    now: NOW,
  });
  assert.equal(first.enqueuedJobIds.length, 1);
  assert.equal(second.enqueuedJobIds.length, 0);
  assert.ok(second.skippedReasons.some((r) => r.includes("active_job") || r.includes("awaiting_outcome")));
});

test("concurrent scheduler passes do not duplicate job ids", async () => {
  const store = new MemoryOrchestrationQueueStore();
  registerPhase6bAgents(store, NOW);
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-race",
    projectId: "medimori",
    parentObjective: "Race test",
    now: NOW,
  });
  const tasks = plan.tasks.map((t) => (t.id === "task-plan" ? { ...t, state: "ready" as const } : t));
  const record = createObjectiveExecutionRecord({
    plan: { ...plan, tasks },
    idempotencyKey: "idem-race",
    now: NOW,
  });
  record.lifecycleState = "executing";

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      scheduleEligiblePlanTasks({ store, record, backends, now: NOW }).then((r) => r.enqueuedJobIds),
    ),
  );
  const totalEnqueued = results.reduce((sum, ids) => sum + ids.length, 0);
  assert.equal(totalEnqueued, 1);
});
