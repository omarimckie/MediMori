import assert from "node:assert/strict";
import test from "node:test";
import { matchWorkerForTask } from "../phase6a/worker-matching";
import { buildActionableApprovalRequest, attachPendingApproval } from "../phase6b/approval-escalation";
import { createObjectiveExecutionRecord } from "../phase6b/objective-execution-record";
import { offlineObjectivePlanner } from "../phase6a/objective-plan";

const NOW = "2026-10-26T22:30:00.000Z";

test("QA cannot certify its own implementation task", () => {
  const match = matchWorkerForTask({
    projectId: "medimori",
    requiredCapabilities: ["independent_review", "verify_evidence"],
    taskOperations: ["independent_review"],
    backends: [{ role: "qa_independent_review", adapterEnabled: true, concurrentSlots: 1 }],
    budgetRemainingUsd: 2,
    candidateTaskId: "task-implement",
    implementerTaskIds: ["task-implement"],
  });
  assert.equal(match.ok, false);
});

test("unavailable worker blocks with no_backend", () => {
  const match = matchWorkerForTask({
    projectId: "medimori",
    requiredCapabilities: ["prepare_plan"],
    taskOperations: ["prepare_plan"],
    backends: [{ role: "engineering", adapterEnabled: false, concurrentSlots: 0 }],
    budgetRemainingUsd: 2,
    candidateTaskId: "task-implement",
  });
  assert.equal(match.ok, false);
  if (!match.ok) assert.equal(match.code, "no_backend");
});

test("expired approval scenario produces owner refresh request", () => {
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-expired-approval",
    projectId: "medimori",
    parentObjective: "Deploy",
    now: NOW,
  });
  let record = createObjectiveExecutionRecord({
    plan,
    idempotencyKey: "idem-expired",
    now: NOW,
  });
  const actionable = buildActionableApprovalRequest({
    record,
    report: {
      taskId: "task-implement",
      workerId: "worker-1",
      role: "engineering",
      outcome: "missing_permission",
    },
    now: NOW,
    scenarioKey: "expired_approval",
  });
  record = attachPendingApproval(record, actionable.approval, NOW);
  assert.equal(record.lifecycleState, "awaiting_owner_approval");
  assert.match(actionable.ownerMessage, /approval/i);
});
