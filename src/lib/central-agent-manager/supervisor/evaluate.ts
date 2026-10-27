import { assessApproval } from "./approval";
import { budgetBlockReason, usageForEvaluation } from "./budget";
import { isKnownOperation, requiresOwnerApproval } from "./protected-operations";
import { getSpecialistProfile } from "./registry";
import {
  assertTimestamp,
  SupervisorContractError,
  type BudgetUsage,
  type ExecutionDecision,
  type SpecialistProfile,
  type SupervisorTask,
} from "./types";
import type { ApprovalEvidence } from "./types";

export type EvaluationInput = {
  task: SupervisorTask;
  operation: string;
  approval: ApprovalEvidence | null;
  proposedUsage?: BudgetUsage | null;
  isolationSatisfied: boolean;
  now: string;
};

function sameScope(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function outsideProfile(profile: SpecialistProfile, operation: string): boolean {
  return profile.absoluteProhibitions.includes(operation) || !profile.requestableOperations.includes(operation);
}

function stateDecision(task: SupervisorTask): ExecutionDecision | null {
  if (task.state === "awaiting_approval") {
    return { outcome: "requires_approval", reason: "Task is awaiting approval." };
  }
  if (task.state !== "approved") {
    return { outcome: "blocked", reason: `Task in ${task.state} cannot execute.` };
  }
  return null;
}

export type BindingGateDecision =
  | ExecutionDecision
  | { outcome: "trusted_binding_required" };

function decide(input: EvaluationInput): BindingGateDecision {
  assertTimestamp(input.now, "Evaluation time");
  if (!isKnownOperation(input.operation)) {
    return { outcome: "denied", reason: "Unknown operation." };
  }
  let profile: SpecialistProfile;
  try {
    profile = getSpecialistProfile(input.task.specialistId);
  } catch (error) {
    if (error instanceof SupervisorContractError) {
      return { outcome: "denied", reason: "Unknown specialist." };
    }
    throw error;
  }
  if (profile.absoluteProhibitions.includes(input.operation)) {
    return { outcome: "denied", reason: "Operation is prohibited for this specialist." };
  }
  if (!profile.requestableOperations.includes(input.operation)) {
    return { outcome: "denied", reason: "Operation is outside the specialist profile." };
  }
  if (!Array.isArray(input.task.requestedOperations) || !Array.isArray(input.task.allowedCapabilityScope)) {
    return { outcome: "denied", reason: "Task scope is wider than the specialist profile." };
  }
  const scope = [...input.task.requestedOperations, ...input.task.allowedCapabilityScope];
  if (
    !input.task.requestedOperations.includes(input.operation) ||
    !sameScope(input.task.requestedOperations, input.task.allowedCapabilityScope) ||
    scope.some((operation) => outsideProfile(profile, operation))
  ) {
    return { outcome: "denied", reason: "Task scope is wider than the specialist profile." };
  }

  const state = stateDecision(input.task);
  if (state) return state;

  let needsTrustedBinding = false;
  if (requiresOwnerApproval(input.operation)) {
    needsTrustedBinding = true;
    const approval = assessApproval(input.task, input.operation, input.approval, input.now);
    if (!approval.ok && approval.reason !== "missing") {
      return { outcome: "denied", reason: `Approval evidence was rejected (${approval.reason}).` };
    }
  }

  const usage = usageForEvaluation(input.task.usage, input.proposedUsage ?? null);
  const budget = budgetBlockReason(input.task.budget, usage, profile.defaultBudget);
  if (budget) return { outcome: "blocked", reason: budget };

  if (profile.isolation !== "shared_process" && !input.isolationSatisfied) {
    return { outcome: "blocked", reason: "Required execution isolation is not satisfied." };
  }
  if (needsTrustedBinding) return { outcome: "trusted_binding_required" };
  return { outcome: "allowed" };
}

export function evaluateBindingGates(input: EvaluationInput): BindingGateDecision {
  return decide(input);
}

export function evaluateExecution(input: EvaluationInput): ExecutionDecision {
  const decision = decide(input);
  if (decision.outcome === "trusted_binding_required") {
    return {
      outcome: "requires_approval",
      reason: "Trusted owner approval verification is required.",
    };
  }
  return decision;
}

export function enterExecution(input: EvaluationInput): SupervisorTask {
  const decision = evaluateExecution(input);
  if (input.task.state !== "approved" || decision.outcome !== "allowed") {
    throw new SupervisorContractError("Protected or ineligible work cannot enter execution.");
  }
  return { ...input.task, state: "running", updatedAt: input.now };
}
