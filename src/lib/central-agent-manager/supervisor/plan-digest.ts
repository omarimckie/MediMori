import { createHash } from "node:crypto";
import { getSpecialistProfile } from "./registry";
import { SupervisorContractError, type BudgetAllocation, type SupervisorTask } from "./types";

/**
 * Canonical plan binding for a trusted approval.
 *
 * The supervisor task has no source-revision or target-revision field.
 * Both are fixed nulls in this document so a missing revision cannot be
 * treated as permission to choose one later. A future engineering handoff
 * has to add verified revisions to this document before that handoff is
 * authorized. Isolation and prohibitions come from the server specialist
 * profile, not from the caller.
 */
export type CanonicalTaskPlan = {
  allowedCapabilityScope: string[];
  budget: BudgetAllocation;
  isolation: string;
  planVersion: number;
  prohibitions: string[];
  requestedOperations: string[];
  sourceRevision: null;
  specialistId: string;
  targetRevision: null;
  taskId: string;
  validationRequired: boolean;
};

export type CanonicalApprovalPlan = CanonicalTaskPlan & {
  environment: string;
  operation: string;
};

const canonicalToken = /^[A-Za-z0-9_.-]{1,80}$/;
const environmentToken = /^[A-Za-z0-9_.-]{1,40}$/;

function assertCanonicalToken(value: string): void {
  if (!canonicalToken.test(value)) throw new SupervisorContractError("Plan digest input is not canonical.");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new SupervisorContractError("Plan digest input is not canonical.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new SupervisorContractError("Plan digest input is not canonical.");
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function canonicalBudget(budget: BudgetAllocation): BudgetAllocation {
  return {
    concurrentSessions: budget.concurrentSessions,
    costUsd: budget.costUsd,
    durationMs: budget.durationMs,
    fileChanges: budget.fileChanges,
    modelCalls: budget.modelCalls,
    repairs: budget.repairs,
    tokens: budget.tokens,
  };
}

export function canonicalTaskPlan(task: SupervisorTask): CanonicalTaskPlan {
  const profile = getSpecialistProfile(task.specialistId);
  assertCanonicalToken(task.id);
  assertCanonicalToken(task.specialistId);
  assertCanonicalToken(profile.isolation);
  for (const operation of [...task.allowedCapabilityScope, ...task.requestedOperations, ...profile.absoluteProhibitions]) {
    assertCanonicalToken(operation);
  }
  if (!Number.isSafeInteger(task.planVersion) || task.planVersion < 0) {
    throw new SupervisorContractError("Plan digest input is not canonical.");
  }
  return {
    allowedCapabilityScope: sortedStrings(task.allowedCapabilityScope),
    budget: canonicalBudget(task.budget),
    isolation: profile.isolation,
    planVersion: task.planVersion,
    prohibitions: sortedStrings(profile.absoluteProhibitions),
    requestedOperations: sortedStrings(task.requestedOperations),
    sourceRevision: null,
    specialistId: task.specialistId,
    targetRevision: null,
    taskId: task.id,
    validationRequired: task.validationRequired,
  };
}

export function canonicalApprovalPlan(input: {
  task: SupervisorTask;
  operation: string;
  environment: string;
}): CanonicalApprovalPlan {
  assertCanonicalToken(input.operation);
  if (!environmentToken.test(input.environment)) {
    throw new SupervisorContractError("Plan digest input is not canonical.");
  }
  return {
    ...canonicalTaskPlan(input.task),
    environment: input.environment,
    operation: input.operation,
  };
}

export function canonicalTaskJson(task: SupervisorTask): string {
  return canonicalJson(canonicalTaskPlan(task));
}

export function canonicalApprovalJson(input: {
  task: SupervisorTask;
  operation: string;
  environment: string;
}): string {
  return canonicalJson(canonicalApprovalPlan(input));
}

function digest(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function taskPlanFingerprint(task: SupervisorTask): string {
  return digest(canonicalTaskJson(task));
}

export function approvalPlanDigest(input: {
  task: SupervisorTask;
  operation: string;
  environment: string;
}): string {
  return digest(canonicalApprovalJson(input));
}
