import { isProjectId } from "../registry";
import type { BudgetAllocation, BudgetUsage } from "../supervisor/types";
import type { ProjectId } from "../types";
import type { CursorDispatchIntent } from "./cursor-dispatch-intent";
import type { CursorDispatchRecoveryAuditRecord } from "./cursor-dispatch-recovery-audit";
import { validateCursorDispatchIntent } from "./cursor-dispatch-intent";
import type { ExternalExecutionReferences } from "./external-execution-refs";
import { validateExternalExecutionReferences } from "./external-execution-refs";
import type { OrchestrationEvidenceRecord } from "./orchestration-evidence";

export const ORCHESTRATION_JOB_CONTRACT_V1 = "central-agent-orchestration-job/v1" as const;
export const ORCHESTRATION_ASSIGNMENT_CONTRACT_V1 = "central-agent-orchestration-assignment/v1" as const;

export const managerJobStates = [
  "queued",
  "blocked",
  "ready",
  "assigned",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ManagerJobState = (typeof managerJobStates)[number];

export const ownerAuthorizationScopes = ["implementation_safe", "owner_approval_required"] as const;
export type OwnerAuthorizationScope = (typeof ownerAuthorizationScopes)[number];

export type JobApprovalBinding = {
  supervisorTaskId: string;
  operation: string;
  approvalRecordId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type JobProvenance = {
  enqueuedBy: string;
  enqueuedAt: string;
  source: "owner" | "manager_policy" | "simulation";
};

/** Serializable job row suitable for future durable storage. */
export type ManagerJobRecord = {
  contractVersion: typeof ORCHESTRATION_JOB_CONTRACT_V1;
  id: string;
  projectId: ProjectId;
  goalId: string;
  description: string;
  priority: number;
  sequence: number;
  state: ManagerJobState;
  dependsOnJobIds: readonly string[];
  requiredCapabilities: readonly string[];
  requestedOperation: string | null;
  ownerAuthorizationScope: OwnerAuthorizationScope;
  budget: BudgetAllocation;
  usage: BudgetUsage;
  attemptCount: number;
  maxAttempts: number;
  retryEligible: boolean;
  assignmentId: string | null;
  activeLeaseFence: number | null;
  supervisorTaskId: string | null;
  approvalBinding: JobApprovalBinding | null;
  evidenceIds: readonly string[];
  terminalOutcome: "none" | "succeeded" | "failed" | "cancelled";
  failureReason: string | null;
  blockReason: string | null;
  provenance: JobProvenance;
  /** Optional correlation to external runtimes; never grants execution authority. */
  externalRefs?: ExternalExecutionReferences;
  /** Durable Cursor bridge dispatch intent mirrored from the active assignment attempt. */
  cursorDispatchIntent?: CursorDispatchIntent;
  createdAt: string;
  updatedAt: string;
};

export const assignmentStates = [
  "active",
  "completed",
  "failed",
  "released",
  "ambiguous",
] as const;
export type AssignmentState = (typeof assignmentStates)[number];

export type AssignmentLease = {
  holderAgentId: string;
  leasedAt: string;
  expiresAt: string;
  dispatchAttempt: number;
  /** Matches job.activeLeaseFence while the assignment is authoritative. */
  fenceToken: number;
};

export type ManagerAssignmentRecord = {
  contractVersion: typeof ORCHESTRATION_ASSIGNMENT_CONTRACT_V1;
  id: string;
  jobId: string;
  projectId: ProjectId;
  agentId: string;
  state: AssignmentState;
  lease: AssignmentLease;
  /** Snapshot of external correlation for this assignment attempt; not authorization. */
  externalRefs?: ExternalExecutionReferences;
  /** Durable executor evidence snapshots persisted with the assignment payload. */
  persistedEvidence?: readonly OrchestrationEvidenceRecord[];
  /** Durable external dispatch lifecycle for Cursor bridge integration. */
  cursorDispatchIntent?: CursorDispatchIntent;
  /** Owner recovery audit trail (persisted in assignment JSON; not authorization). */
  cursorDispatchRecoveryAudit?: readonly CursorDispatchRecoveryAuditRecord[];
  createdAt: string;
  updatedAt: string;
};

export const agentCapacityStatuses = ["available", "busy", "disconnected", "unknown"] as const;
export type AgentCapacityStatus = (typeof agentCapacityStatuses)[number];

export type ManagerAgentRecord = {
  id: string;
  label: string;
  eligibleProjectIds: readonly ProjectId[];
  capabilities: readonly string[];
  status: AgentCapacityStatus;
  maxConcurrentAssignments: number;
  activeAssignmentIds: readonly string[];
  lastObservedAt: string | null;
};

export function serializeManagerJob(job: ManagerJobRecord): string {
  return JSON.stringify(job);
}

export function parseManagerJob(json: string): ManagerJobRecord {
  const parsed = JSON.parse(json) as ManagerJobRecord;
  if (parsed.contractVersion !== ORCHESTRATION_JOB_CONTRACT_V1) {
    throw new Error("Unsupported job contract version.");
  }
  if (!parsed.id?.trim()) {
    throw new Error("Job id is required.");
  }
  if (!isProjectId(parsed.projectId)) {
    throw new Error("Invalid project id.");
  }
  parsed.externalRefs = validateExternalExecutionReferences(parsed.externalRefs);
  const cursorDispatchIntent = validateCursorDispatchIntent(
    (parsed as { cursorDispatchIntent?: unknown }).cursorDispatchIntent,
  );
  if (cursorDispatchIntent) {
    parsed.cursorDispatchIntent = cursorDispatchIntent;
  } else {
    delete parsed.cursorDispatchIntent;
  }
  return parsed;
}
