import type { JobApprovalBinding, ManagerAgentRecord, ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import type { EnqueueJobInput } from "./memory-queue-store";

export type CrashRecoveryReport = {
  recoveredAt: string;
  leasesReconciled: number;
  ambiguousBlocked: number;
  runningWithoutActiveLease: number;
};

/** Durable-ready orchestration persistence boundary (no live DB in tests). */
export type OrchestrationQueuePort = {
  listJobs(): Promise<ManagerJobRecord[]>;
  getJob(id: string): Promise<ManagerJobRecord | null>;
  listAssignments(): Promise<ManagerAssignmentRecord[]>;
  listAgents(): Promise<ManagerAgentRecord[]>;
  enqueueJob(input: EnqueueJobInput): Promise<ManagerJobRecord>;
  cancelJob(jobId: string, now: string): Promise<ManagerJobRecord>;
  bindApproval(jobId: string, binding: JobApprovalBinding, now: string): Promise<ManagerJobRecord>;
  registerAgent(agent: ManagerAgentRecord): Promise<void>;
  observeAgentStatus(agentId: string, status: ManagerAgentRecord["status"], observedAt: string): Promise<void>;
  refreshDependencyReadiness(now: string): Promise<void>;
  reconcileLeases(now: string): Promise<void>;
  runScheduler(now: string): Promise<void>;
  reportAmbiguousOutcome(assignmentId: string, now: string, reason: string): Promise<void>;
  completeAssignment(assignmentId: string, now: string, evidenceIds: readonly string[]): Promise<void>;
  failAssignmentOutcome(assignmentId: string, now: string, reason: string): Promise<void>;
  recoverFromCrash(now: string): Promise<CrashRecoveryReport>;
};
