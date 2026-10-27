import type {
  ApprovalCommitAttempt,
  TaskRunningAttempt,
  TrustedApprovalRecord,
} from "../supervisor/trusted-approval";
import type { SupervisorTask } from "../supervisor/types";

/** Authority-role persistence (issue, revoke, save, read). */
export type ApprovalAuthorityPersistencePort = {
  readTask(taskId: string): Promise<SupervisorTask | null>;
  saveTask(task: SupervisorTask): Promise<void>;
  commitApproval(
    attempt: ApprovalCommitAttempt,
  ): Promise<{ record: TrustedApprovalRecord; task: SupervisorTask }>;
  readApproval(id: string): Promise<TrustedApprovalRecord | null>;
  revokeApproval(id: string, now: string): Promise<TrustedApprovalRecord | null>;
};

/** Executor-role persistence (mark running + read for verification). */
export type ApprovalExecutorPersistencePort = {
  readTask(taskId: string): Promise<SupervisorTask | null>;
  readApproval(id: string): Promise<TrustedApprovalRecord | null>;
  markTaskRunning(attempt: TaskRunningAttempt): Promise<SupervisorTask>;
};

export type ApprovalConnectionLifecycle = {
  /** Called before opening a new authority connection. Must not connect on failure. */
  beforeAuthorityConnect(): void;
  /** Called before opening a new executor connection. Must not connect on failure. */
  beforeExecutorConnect(): void;
  /** Optional: authority session failed verification after connect attempt. */
  afterAuthorityConnectFailed?(): void;
  /** Optional: executor session failed verification after connect attempt. */
  afterExecutorConnectFailed?(): void;
  /** Observe the authority session after connect. */
  observeAuthoritySession(): Promise<import("./identity-guards").ApprovalSessionObservation>;
  /** Observe the executor session after connect. */
  observeExecutorSession(): Promise<import("./identity-guards").ApprovalSessionObservation>;
};
