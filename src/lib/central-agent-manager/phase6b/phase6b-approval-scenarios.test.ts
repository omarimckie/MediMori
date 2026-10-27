import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkerOutcome, createClosedLoopManager, startTaskWorker } from "../phase6a/closed-loop-manager";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";
import { attachPendingApproval, buildActionableApprovalRequest } from "./approval-escalation";
import { createObjectiveExecutionRecord } from "./objective-execution-record";

const NOW = "2026-10-26T21:00:00.000Z";

const backends = [
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "devops" as const, adapterEnabled: true, concurrentSlots: 1 },
];

test("missing permission produces actionable owner approval instead of generic failure", () => {
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-approval",
    projectId: "medimori",
    parentObjective: "Deploy",
    now: NOW,
  });
  let record = createObjectiveExecutionRecord({
    plan,
    idempotencyKey: "idem-approval",
    now: NOW,
  });
  record.lifecycleState = "executing";
  const readyPlan = {
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.id === "task-plan"
        ? { ...t, state: "completed" as const }
        : t.id === "task-implement"
          ? { ...t, state: "ready" as const }
          : t,
    ),
  };
  let closedLoop = createClosedLoopManager(readyPlan);
  const started = startTaskWorker(closedLoop, "task-implement", backends, "medimori", NOW);
  assert.ok("workerId" in started);
  closedLoop = started.state;
  closedLoop = applyWorkerOutcome(
    closedLoop,
    {
      taskId: "task-implement",
      workerId: started.workerId,
      role: "engineering",
      outcome: "missing_permission",
      protectedOperation: "production_deploy",
    },
    backends,
    NOW,
  );
  record = { ...record, closedLoop };
  const actionable = buildActionableApprovalRequest({
    record,
    report: {
      taskId: "task-implement",
      workerId: "worker-1",
      role: "engineering",
      outcome: "missing_permission",
      protectedOperation: "production_deploy",
    },
    now: NOW,
    scenarioKey: "production_deploy",
  });
  record = attachPendingApproval(record, actionable.approval, NOW);
  assert.equal(record.lifecycleState, "awaiting_owner_approval");
  assert.ok(actionable.ownerMessage.includes("production"));
  assert.ok(record.pendingApprovals[0].protectedOperation === "production_deploy");
});
