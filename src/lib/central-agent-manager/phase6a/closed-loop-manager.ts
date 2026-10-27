import { SupervisorContractError } from "../supervisor/types";
import { refreshPlanReadiness, validateObjectivePlan, type ObjectivePlanV1, type PlanTaskRecord } from "./objective-plan";
import type { ProjectId } from "./project-policy";
import { matchWorkerForTask, type WorkerBackendAvailability } from "./worker-matching";
import { WorkerLifecycleStore } from "./worker-lifecycle";
import type { SpecialistTemplateRole } from "./specialist-template-registry";

export const WORKER_OUTCOMES = [
  "completed_success",
  "recoverable_technical_failure",
  "missing_dependency",
  "missing_permission",
  "environment_failure",
  "budget_exhausted",
  "unclear_requirements",
  "permanent_failure",
] as const;

export type WorkerOutcome = (typeof WORKER_OUTCOMES)[number];

export type ManagerRecoveryAction =
  | "retry_with_backoff"
  | "create_corrective_subtask"
  | "reassign_authorized_specialist"
  | "wait_for_dependency"
  | "request_owner_approval"
  | "escalate_unresolved"
  | "mark_objective_blocked";

export type ClosedLoopManagerState = {
  plan: ObjectivePlanV1;
  budgetRemainingUsd: number;
  followUpTasksCreated: number;
  workers: WorkerLifecycleStore;
  objectiveState: "active" | "blocked" | "completed" | "awaiting_owner_approval";
  auditLog: string[];
  finalSummary?: string;
};

export type WorkerOutcomeReport = {
  taskId: string;
  workerId: string;
  role: SpecialistTemplateRole;
  outcome: WorkerOutcome;
  evidenceIds?: string[];
  protectedOperation?: string;
  ownerApprovalGranted?: boolean;
};

export function createClosedLoopManager(plan: ObjectivePlanV1): ClosedLoopManagerState {
  validateObjectivePlan(plan);
  return {
    plan,
    budgetRemainingUsd: plan.budgetUsd,
    followUpTasksCreated: 0,
    workers: new WorkerLifecycleStore(),
    objectiveState: "active",
    auditLog: [],
  };
}

export function decideRecoveryAction(
  report: WorkerOutcomeReport,
  state: ClosedLoopManagerState,
): ManagerRecoveryAction {
  switch (report.outcome) {
    case "completed_success":
      return "wait_for_dependency";
    case "recoverable_technical_failure":
      return state.followUpTasksCreated < state.plan.retryPolicy.maxFollowUpTasks
        ? "create_corrective_subtask"
        : "escalate_unresolved";
    case "missing_dependency":
      return "wait_for_dependency";
    case "missing_permission":
      return report.protectedOperation && !report.ownerApprovalGranted
        ? "request_owner_approval"
        : "mark_objective_blocked";
    case "environment_failure":
      return "retry_with_backoff";
    case "budget_exhausted":
      return "mark_objective_blocked";
    case "unclear_requirements":
      return "escalate_unresolved";
    case "permanent_failure":
      return "mark_objective_blocked";
    default:
      return "escalate_unresolved";
  }
}

export function applyWorkerOutcome(
  state: ClosedLoopManagerState,
  report: WorkerOutcomeReport,
  backends: WorkerBackendAvailability[],
  now: string,
): ClosedLoopManagerState {
  if (state.objectiveState !== "active" && state.objectiveState !== "awaiting_owner_approval") {
    return state;
  }
  const action = decideRecoveryAction(report, state);
  state.auditLog.push(`${now}:${report.taskId}:${report.outcome}:${action}`);
  const tasks = [...state.plan.tasks];
  const taskIndex = tasks.findIndex((t) => t.id === report.taskId);
  if (taskIndex < 0) throw new SupervisorContractError("Unknown plan task.");
  const task = tasks[taskIndex];

  if (report.outcome === "completed_success") {
    tasks[taskIndex] = { ...task, state: "completed" };
    state.workers.apply({ type: "complete", workerId: report.workerId, now });
    let plan = { ...state.plan, tasks };
    plan = refreshPlanReadiness(plan);
    const allDone = plan.tasks.every((t) => t.state === "completed");
    return {
      ...state,
      plan,
      objectiveState: allDone ? "completed" : "active",
      finalSummary: allDone ? `Objective ${plan.objectiveId} completed with auditable evidence.` : state.finalSummary,
    };
  }

  if (action === "request_owner_approval") {
    tasks[taskIndex] = { ...task, state: "blocked" };
    state.workers.apply({ type: "block", workerId: report.workerId, now, reason: "owner_approval" });
    return { ...state, plan: { ...state.plan, tasks }, objectiveState: "awaiting_owner_approval" };
  }

  if (action === "create_corrective_subtask") {
    if (state.followUpTasksCreated >= state.plan.retryPolicy.maxFollowUpTasks) {
      return { ...state, objectiveState: "blocked", auditLog: [...state.auditLog, `${now}:follow_up_cap`] };
    }
    const correctiveId = `${report.taskId}-fix-${state.followUpTasksCreated + 1}`;
    const corrective: PlanTaskRecord = {
      id: correctiveId,
      title: `Corrective work for ${report.taskId}`,
      requiredCapabilities: task.requiredCapabilities,
      dependsOn: [],
      acceptanceCriteria: task.acceptanceCriteria,
      protectedOperations: [],
      maxRetries: 1,
      evidenceRequired: task.evidenceRequired,
      assignedRole: task.assignedRole,
      state: "ready",
    };
    tasks.push(corrective);
    state.workers.apply({ type: "fail", workerId: report.workerId, now, reason: report.outcome });
    return {
      ...state,
      plan: validateObjectivePlanAndReturn({ ...state.plan, tasks }),
      followUpTasksCreated: state.followUpTasksCreated + 1,
    };
  }

  if (action === "retry_with_backoff") {
    tasks[taskIndex] = { ...task, state: "ready" };
    state.workers.apply({ type: "fail", workerId: report.workerId, now, reason: report.outcome });
    return { ...state, plan: { ...state.plan, tasks } };
  }

  if (action === "mark_objective_blocked" || action === "escalate_unresolved") {
    tasks[taskIndex] = { ...task, state: "failed" };
    state.workers.apply({ type: "block", workerId: report.workerId, now, reason: action });
    return { ...state, plan: { ...state.plan, tasks }, objectiveState: "blocked" };
  }

  return state;
}

function validateObjectivePlanAndReturn(plan: ObjectivePlanV1): ObjectivePlanV1 {
  validateObjectivePlan(plan);
  return plan;
}

export function startTaskWorker(
  state: ClosedLoopManagerState,
  taskId: string,
  backends: WorkerBackendAvailability[],
  projectId: ProjectId,
  now: string,
): { state: ClosedLoopManagerState; workerId: string } | { error: string } {
  const task = state.plan.tasks.find((t) => t.id === taskId);
  if (!task || (task.state !== "ready" && task.state !== "running")) {
    return { error: "Task is not ready." };
  }
  const implementerTaskIds = state.plan.tasks
    .filter((t) => t.assignedRole === "engineering")
    .map((t) => t.id);
  const match = matchWorkerForTask({
    projectId,
    requiredCapabilities: task.requiredCapabilities,
    taskOperations: [...task.requiredCapabilities, ...task.protectedOperations],
    backends,
    budgetRemainingUsd: state.budgetRemainingUsd,
    candidateTaskId: task.id,
    implementerTaskIds:
      task.assignedRole === "qa_independent_review" ? implementerTaskIds : undefined,
  });
  if (!match.ok) return { error: match.reason };
  const workerId = `worker-${taskId}-${state.workers.list().length + 1}`;
  state.workers.apply({
    type: "provision",
    workerId,
    role: match.role,
    objectiveId: state.plan.objectiveId,
    taskId,
    now,
  });
  state.workers.apply({ type: "assign", workerId, now });
  state.workers.apply({ type: "start", workerId, now });
  const tasks = state.plan.tasks.map((row) => (row.id === taskId ? { ...row, state: "running" as const } : row));
  return { state: { ...state, plan: { ...state.plan, tasks } }, workerId };
}
