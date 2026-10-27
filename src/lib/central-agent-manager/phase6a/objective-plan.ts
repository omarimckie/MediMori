import { SupervisorContractError } from "../supervisor/types";

export const OBJECTIVE_PLAN_CONTRACT_V1 = "cam-objective-plan/v1" as const;

export type PlanTaskState = "pending" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export type PlanTaskRecord = {
  id: string;
  title: string;
  requiredCapabilities: readonly string[];
  dependsOn: readonly string[];
  acceptanceCriteria: readonly string[];
  protectedOperations: readonly string[];
  maxRetries: number;
  evidenceRequired: readonly string[];
  assignedRole?: string;
  state: PlanTaskState;
};

export type ObjectivePlanV1 = {
  contractVersion: typeof OBJECTIVE_PLAN_CONTRACT_V1;
  objectiveId: string;
  projectId: "medimori" | "twilight_feather";
  parentObjective: string;
  budgetUsd: number;
  deadlineAt: string;
  retryPolicy: { maxFollowUpTasks: number; maxRetriesPerTask: number };
  tasks: PlanTaskRecord[];
};

export type ObjectivePlannerPort = {
  createPlan(input: {
    objectiveId: string;
    projectId: ObjectivePlanV1["projectId"];
    parentObjective: string;
    now: string;
  }): ObjectivePlanV1;
};

export function validateObjectivePlan(plan: ObjectivePlanV1): void {
  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) {
      throw new SupervisorContractError("Duplicate plan task id.");
    }
    ids.add(task.id);
  }
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        throw new SupervisorContractError("Plan task depends on unknown task.");
      }
      if (dep === task.id) {
        throw new SupervisorContractError("Plan task cannot depend on itself.");
      }
    }
  }
  if (hasDependencyCycle(plan.tasks)) {
    throw new SupervisorContractError("Plan dependency cycle detected.");
  }
  if (plan.budgetUsd <= 0) {
    throw new SupervisorContractError("Plan budget must be positive.");
  }
}

function hasDependencyCycle(tasks: PlanTaskRecord[]): boolean {
  const graph = new Map(tasks.map((task) => [task.id, [...task.dependsOn]]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  for (const task of tasks) {
    if (dfs(task.id)) return true;
  }
  return false;
}

export function refreshPlanReadiness(plan: ObjectivePlanV1): ObjectivePlanV1 {
  const completed = new Set(plan.tasks.filter((t) => t.state === "completed").map((t) => t.id));
  const nextTasks = plan.tasks.map((task) => {
    if (task.state !== "pending") return task;
    const depsMet = task.dependsOn.every((dep) => completed.has(dep));
    return depsMet ? { ...task, state: "ready" as const } : task;
  });
  return { ...plan, tasks: nextTasks };
}

export function assertObjectiveNotPrematurelyComplete(plan: ObjectivePlanV1): void {
  const incomplete = plan.tasks.filter((t) => t.state !== "completed" && t.state !== "cancelled");
  if (incomplete.length === 0) return;
  const allTerminal = plan.tasks.every((t) =>
    t.state === "completed" || t.state === "failed" || t.state === "cancelled",
  );
  if (!allTerminal) {
    throw new SupervisorContractError("Objective cannot complete while tasks are still active.");
  }
}

export const offlineObjectivePlanner: ObjectivePlannerPort = {
  createPlan(input) {
    const plan: ObjectivePlanV1 = {
      contractVersion: OBJECTIVE_PLAN_CONTRACT_V1,
      objectiveId: input.objectiveId,
      projectId: input.projectId,
      parentObjective: input.parentObjective,
      budgetUsd: 3,
      deadlineAt: input.now,
      retryPolicy: { maxFollowUpTasks: 12, maxRetriesPerTask: 2 },
      tasks: [
        {
          id: "task-plan",
          title: "Research and decompose",
          requiredCapabilities: ["prepare_research_report", "prepare_plan"],
          dependsOn: [],
          acceptanceCriteria: ["plan_documented"],
          protectedOperations: [],
          maxRetries: 1,
          evidenceRequired: ["plan_proposal"],
          assignedRole: "research_planning",
          state: "ready",
        },
        {
          id: "task-implement",
          title: "Engineering implementation",
          requiredCapabilities: ["prepare_plan", "run_allowlisted_validation"],
          dependsOn: ["task-plan"],
          acceptanceCriteria: ["implementation_evidence"],
          protectedOperations: [],
          maxRetries: 2,
          evidenceRequired: ["work_completed"],
          assignedRole: "engineering",
          state: "pending",
        },
        {
          id: "task-qa",
          title: "Independent QA review",
          requiredCapabilities: ["independent_review", "verify_evidence"],
          dependsOn: ["task-implement"],
          acceptanceCriteria: ["qa_passed"],
          protectedOperations: [],
          maxRetries: 1,
          evidenceRequired: ["qa_passed"],
          assignedRole: "qa_independent_review",
          state: "pending",
        },
      ],
    };
    validateObjectivePlan(plan);
    return plan;
  },
};
