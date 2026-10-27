import { hasVerifiedCompletion } from "./evidence";
import { requiresOwnerApproval } from "./protected-operations";
import { getSpecialistProfile } from "./registry";
import {
  assertIdentifier,
  assertTimestamp,
  emptyUsage,
  SupervisorContractError,
  type EvidenceRecord,
  type SpecialistId,
  type SpecialistProfile,
  type SupervisorTask,
  type TaskState,
} from "./types";

const transitions: Record<TaskState, readonly TaskState[]> = {
  created: ["awaiting_approval", "cancelled", "blocked"],
  awaiting_approval: ["cancelled", "blocked"],
  approved: ["cancelled", "blocked"],
  running: ["completed", "failed", "cancelled", "blocked"],
  completed: [],
  failed: ["awaiting_approval", "cancelled", "blocked"],
  cancelled: [],
  blocked: ["awaiting_approval", "cancelled"],
};

export function transitionTask(task: SupervisorTask, to: TaskState, now: string): SupervisorTask {
  assertTimestamp(now, "Update time");
  if (to === "running") {
    throw new SupervisorContractError("Running requires enterExecution after an allowed decision.");
  }
  if (to === "completed") {
    throw new SupervisorContractError("Completion requires completeTask with verified evidence.");
  }
  if (!transitions[task.state].includes(to)) {
    throw new SupervisorContractError(`Cannot transition a task from ${task.state} to ${to}.`);
  }
  return {
    ...task,
    state: to,
    approvalState: to === "awaiting_approval" ? "pending" : task.approvalState,
    outcome: to === "cancelled" ? "cancelled" : to === "blocked" ? "blocked" : task.outcome,
    updatedAt: now,
  };
}

function assertCanonicalScope(profile: SpecialistProfile, task: SupervisorTask): void {
  const scope = [...task.requestedOperations, ...task.allowedCapabilityScope];
  if (
    scope.some(
      (operation) =>
        profile.absoluteProhibitions.includes(operation) ||
        !profile.requestableOperations.includes(operation),
    )
  ) {
    throw new SupervisorContractError("A specialist cannot expand its capability scope.");
  }
}

export function markPolicyEligible(task: SupervisorTask, now: string): SupervisorTask {
  assertTimestamp(now, "Update time");
  if (task.state !== "awaiting_approval") {
    throw new SupervisorContractError("Only a waiting task can become policy-eligible.");
  }
  assertCanonicalScope(getSpecialistProfile(task.specialistId), task);
  if (task.requestedOperations.some((operation) => requiresOwnerApproval(operation))) {
    throw new SupervisorContractError("Owner approval is required.");
  }
  return { ...task, state: "approved", approvalState: "policy_eligible", updatedAt: now };
}

export function completeTask(
  task: SupervisorTask,
  evidence: readonly EvidenceRecord[],
  now: string,
): SupervisorTask {
  assertTimestamp(now, "Update time");
  if (task.state !== "running") {
    throw new SupervisorContractError("Only a running task can complete.");
  }
  if (!hasVerifiedCompletion(task, evidence)) {
    throw new SupervisorContractError("Verified completion evidence is required.");
  }
  return { ...task, state: "completed", outcome: "succeeded", updatedAt: now };
}

export function createSupervisorTask(input: {
  id: string;
  goalId: string;
  specialistId: SpecialistId;
  description: string;
  requestedOperations: readonly string[];
  idempotencyKey: string;
  planVersion?: number;
  now: string;
}): SupervisorTask {
  assertIdentifier(input.id, "Task id");
  assertIdentifier(input.goalId, "Goal id");
  assertIdentifier(input.idempotencyKey, "Idempotency key");
  assertTimestamp(input.now, "Creation time");
  if (!input.description.trim() || input.description.length > 4_000) {
    throw new SupervisorContractError("Task description is required.");
  }
  const profile = getSpecialistProfile(input.specialistId);
  if (!input.requestedOperations.length) {
    throw new SupervisorContractError("At least one operation is required.");
  }
  for (const operation of input.requestedOperations) {
    if (
      profile.absoluteProhibitions.includes(operation) ||
      !profile.requestableOperations.includes(operation)
    ) {
      throw new SupervisorContractError("A specialist cannot expand its capability scope.");
    }
  }
  const planVersion = input.planVersion ?? 0;
  if (!Number.isInteger(planVersion) || planVersion < 0) {
    throw new SupervisorContractError("Plan version is invalid.");
  }
  return {
    id: input.id,
    goalId: input.goalId,
    specialistId: input.specialistId,
    description: input.description.trim(),
    allowedCapabilityScope: [...input.requestedOperations],
    requestedOperations: [...input.requestedOperations],
    approvalState: "none",
    state: "created",
    budget: { ...profile.defaultBudget },
    usage: emptyUsage(),
    sessionId: null,
    evidenceIds: [],
    outcome: "none",
    failure: "none",
    idempotencyKey: input.idempotencyKey,
    planVersion,
    validationRequired: profile.completionRequiresValidation,
    lease: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
