import { limits } from "./protected-operations";

export class SupervisorContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorContractError";
  }
}

export const specialistIds = ["marketing", "engineering", "research", "operations"] as const;
export type SpecialistId = (typeof specialistIds)[number];

export type IsolationRequirement = "shared_process" | "isolated_workspace" | "read_only_credential";

export type BudgetAllocation = {
  modelCalls: number;
  tokens: number;
  costUsd: number;
  durationMs: number;
  repairs: number;
  fileChanges: number;
  concurrentSessions: number;
};

export type BudgetUsage = {
  modelCalls: number | null;
  tokens: number | null;
  costUsd: number | null;
  elapsedMs: number | null;
  repairs: number | null;
  fileChanges: number | null;
  concurrentSessions: number | null;
};

export type SpecialistProfile = {
  id: SpecialistId;
  displayName: string;
  responsibility: string;
  permittedToolCategories: readonly string[];
  requestableOperations: readonly string[];
  absoluteProhibitions: readonly string[];
  isolation: IsolationRequirement;
  defaultBudget: BudgetAllocation;
  supportedTaskTypes: readonly string[];
  /** Names the future adapter. This module never constructs it. */
  adapterId: string;
  completionRequiresValidation: boolean;
};

export const taskStates = [
  "created",
  "awaiting_approval",
  "approved",
  "running",
  "completed",
  "failed",
  "cancelled",
  "blocked",
] as const;
export type TaskState = (typeof taskStates)[number];

export type Principal =
  | { kind: "owner"; id: string }
  | { kind: "manager"; id: string }
  | { kind: "specialist"; id: string }
  | { kind: "system_policy"; id: "eligibility" };

export type ApprovalEvidence = {
  id: string;
  taskId: string;
  operation: string;
  principal: Principal;
  scope: { taskId: string; operation: string; planVersion: number };
  decision: "approved" | "rejected";
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  planVersion: number;
};

export type TaskLease = { holderSessionId: string; expiresAt: string };

export type SupervisorTask = {
  id: string;
  goalId: string;
  specialistId: SpecialistId;
  description: string;
  allowedCapabilityScope: readonly string[];
  requestedOperations: readonly string[];
  approvalState: "none" | "pending" | "policy_eligible" | "owner_approved" | "rejected";
  state: TaskState;
  budget: BudgetAllocation;
  usage: BudgetUsage;
  sessionId: string | null;
  evidenceIds: readonly string[];
  outcome: "none" | "succeeded" | "failed" | "cancelled" | "blocked";
  failure: "none" | "policy" | "budget" | "validation" | "session" | "unknown";
  idempotencyKey: string;
  planVersion: number;
  validationRequired: boolean;
  lease: TaskLease | null;
  createdAt: string;
  updatedAt: string;
};

export const sessionStates = [
  "not_started",
  "starting",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled",
  "terminated",
] as const;
export type SessionState = (typeof sessionStates)[number];

export type SessionRecord = {
  id: string;
  taskId: string;
  specialistId: SpecialistId;
  adapterId: string;
  externalSessionRef: string | null;
  state: SessionState;
  startedAt: string | null;
  endedAt: string | null;
  cancellation: "none" | "requested" | "cancelled";
  failure: "none" | "policy" | "budget" | "validation" | "session" | "unknown";
  usage: BudgetUsage;
  evidenceIds: readonly string[];
};

export const evidenceKinds = [
  "proposed",
  "work_started",
  "work_completed",
  "validation_performed",
  "validation_passed",
  "validation_failed",
  "approval_received",
  "execution_blocked",
  "session_terminated",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export type EvidenceRecord = {
  id: string;
  taskId: string;
  sessionId: string | null;
  kind: EvidenceKind;
  source: "model" | "executor" | "validator" | "owner" | "policy";
  createdAt: string;
  verification: "unverified" | "verified" | "rejected";
  artifactRef: string | null;
  diagnostic: string;
};

export type ExecutionDecision =
  | { outcome: "allowed" }
  | { outcome: "requires_approval"; reason: string }
  | { outcome: "denied"; reason: string }
  | { outcome: "blocked"; reason: string };

export const engineeringBudget: BudgetAllocation = Object.freeze({
  modelCalls: limits.modelCalls,
  tokens: limits.tokens,
  costUsd: limits.costUsd,
  durationMs: limits.durationMs,
  repairs: limits.repairs,
  fileChanges: limits.contextFiles,
  concurrentSessions: 1,
});

export function emptyUsage(): BudgetUsage {
  return {
    modelCalls: 0,
    tokens: 0,
    costUsd: 0,
    elapsedMs: 0,
    repairs: 0,
    fileChanges: 0,
    concurrentSessions: 0,
  };
}

export function assertIdentifier(value: string, label: string): void {
  if (!/^[\w.-]{1,80}$/.test(value)) {
    throw new SupervisorContractError(`${label} is not a stable identifier.`);
  }
}

export function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new SupervisorContractError(`${label} is not a timestamp.`);
  }
}
