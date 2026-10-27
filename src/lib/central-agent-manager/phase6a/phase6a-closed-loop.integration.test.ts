import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkerOutcome,
  createClosedLoopManager,
  startTaskWorker,
  type WorkerOutcomeReport,
} from "./closed-loop-manager";
import { offlineObjectivePlanner, refreshPlanReadiness } from "./objective-plan";
import { buildOwnerProgressReport } from "./owner-progress-report";
import type { WorkerBackendAvailability } from "./worker-matching";

const NOW = "2026-10-26T16:00:00.000Z";

const backends: WorkerBackendAvailability[] = [
  { role: "research_planning", adapterEnabled: true, concurrentSlots: 2 },
  { role: "engineering", adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review", adapterEnabled: true, concurrentSlots: 1 },
  { role: "devops", adapterEnabled: true, concurrentSlots: 1 },
];

function completeTask(plan: ReturnType<typeof createClosedLoopManager>["plan"], taskId: string) {
  const tasks = plan.tasks.map((t) => (t.id === taskId ? { ...t, state: "completed" as const } : t));
  return refreshPlanReadiness({ ...plan, tasks });
}

test("engineering → QA closed loop with corrective work and auditable completion", () => {
  const basePlan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-6a-e2e",
    projectId: "medimori",
    parentObjective: "Ship offline feature",
    now: NOW,
  });
  let state = createClosedLoopManager(basePlan);
  state = { ...state, plan: completeTask(state.plan, "task-plan") };

  const engStart = startTaskWorker(state, "task-implement", backends, "medimori", NOW);
  assert.ok("workerId" in engStart);
  state = engStart.state;
  const engWorker = engStart.workerId;

  state = applyWorkerOutcome(
    state,
    {
      taskId: "task-implement",
      workerId: engWorker,
      role: "engineering",
      outcome: "recoverable_technical_failure",
    },
    backends,
    NOW,
  );
  assert.ok(state.followUpTasksCreated === 1);

  const corrective = state.plan.tasks.find((t) => t.id.startsWith("task-implement-fix"));
  assert.ok(corrective);
  const fixStart = startTaskWorker(state, corrective!.id, backends, "medimori", NOW);
  assert.ok("workerId" in fixStart);
  state = applyWorkerOutcome(
    fixStart.state,
    {
      taskId: corrective!.id,
      workerId: fixStart.workerId,
      role: "engineering",
      outcome: "completed_success",
      evidenceIds: ["ev-eng-fix"],
    },
    backends,
    NOW,
  );
  state = { ...state, plan: completeTask(state.plan, "task-implement") };

  const qaStart = startTaskWorker(state, "task-qa", backends, "medimori", NOW);
  assert.ok("workerId" in qaStart);
  state = applyWorkerOutcome(
    qaStart.state,
    {
      taskId: "task-qa",
      workerId: qaStart.workerId,
      role: "qa_independent_review",
      outcome: "environment_failure",
    },
    backends,
    NOW,
  );
  const qaRetry = startTaskWorker(state, "task-qa", backends, "medimori", NOW);
  assert.ok("workerId" in qaRetry);
  state = applyWorkerOutcome(
    qaRetry.state,
    {
      taskId: "task-qa",
      workerId: qaRetry.workerId,
      role: "qa_independent_review",
      outcome: "completed_success",
      evidenceIds: ["ev-qa-pass"],
    },
    backends,
    NOW,
  );

  assert.equal(state.objectiveState, "completed");
  const report = buildOwnerProgressReport(state);
  assert.equal(report.objectiveStatus, "completed");
  assert.ok(report.completedTasks.includes("task-qa"));
  assert.ok(report.finalOutcome?.includes("obj-6a-e2e"));
});

test("protected operation pauses objective without owner approval", () => {
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-6a-approval",
    projectId: "medimori",
    parentObjective: "Deploy",
    now: NOW,
  });
  const tasks = plan.tasks.map((t) =>
    t.id === "task-implement"
      ? { ...t, state: "ready" as const, protectedOperations: ["production_deploy"] as const }
      : t,
  );
  let state = createClosedLoopManager({ ...plan, tasks });
  const eng = startTaskWorker(state, "task-implement", backends, "medimori", NOW);
  assert.ok("workerId" in eng);
  state = applyWorkerOutcome(
    eng.state,
    {
      taskId: "task-implement",
      workerId: eng.workerId,
      role: "engineering",
      outcome: "missing_permission",
      protectedOperation: "production_deploy",
      ownerApprovalGranted: false,
    },
    backends,
    NOW,
  );
  assert.equal(state.objectiveState, "awaiting_owner_approval");
  const progress = buildOwnerProgressReport(state);
  assert.equal(progress.requiredOwnerDecision, "owner_approval_for_protected_operation");
});

test("QA worker cannot be matched to engineering implementation task", () => {
  const plan = offlineObjectivePlanner.createPlan({
    objectiveId: "obj-6a-qa-sep",
    projectId: "medimori",
    parentObjective: "QA separation",
    now: NOW,
  });
  let state = createClosedLoopManager(completeTask(plan, "task-plan"));
  state = { ...state, plan: completeTask(state.plan, "task-implement") };
  const qa = startTaskWorker(state, "task-implement", backends, "medimori", NOW);
  assert.equal("error" in qa, true);
});
