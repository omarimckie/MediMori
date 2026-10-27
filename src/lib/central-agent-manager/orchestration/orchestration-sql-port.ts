export type OrchestrationSqlRow = {
  id: string;
  payload_json: string;
  updated_at: string;
  job_id?: string;
};

export type OrchestrationSqlQuarantineRow = {
  id: string;
  source_table: string;
  payload_json: string;
  reason: string;
  quarantined_at: string;
};

export type OrchestrationSqlPort = {
  withTransaction<T>(work: (tx: OrchestrationSqlPort) => Promise<T>): Promise<T>;
  loadJobs(): Promise<OrchestrationSqlRow[]>;
  loadAssignments(): Promise<OrchestrationSqlRow[]>;
  loadAgents(): Promise<OrchestrationSqlRow[]>;
  loadQuarantined(): Promise<OrchestrationSqlQuarantineRow[]>;
  upsertJob(row: OrchestrationSqlRow): Promise<void>;
  /**
   * Inserts a new job or updates an existing row only when no consumer owns the job
   * (no active assignment and stored state is not running/assigned).
   */
  upsertJobIfOwnerWritable(row: OrchestrationSqlRow): Promise<boolean>;
  upsertAssignment(row: OrchestrationSqlRow & { job_id?: string }): Promise<void>;
  upsertAgent(row: OrchestrationSqlRow): Promise<void>;
  deleteJob(id: string): Promise<void>;
  quarantineRecord(row: OrchestrationSqlQuarantineRow): Promise<void>;
  tryClaimReadyJob(input: {
    jobId: string;
    jobJson: string;
    assignmentId: string;
    assignmentJson: string;
    assignmentJobId: string;
    now: string;
  }): Promise<boolean>;
  renewAssignmentLease(input: {
    assignmentId: string;
    assignmentJson: string;
    fenceToken: number;
    now: string;
  }): Promise<boolean>;
  /** Persists assignment + job when the stored lease fence still matches (cross-process safe). */
  updateAssignmentWithJobIfFence(input: {
    assignmentId: string;
    assignmentJson: string;
    fenceToken: number;
    jobId: string;
    jobJson: string;
    now: string;
    /** When set, the assignment row must still be in one of these states before write. */
    allowedAssignmentStates?: readonly string[];
  }): Promise<boolean>;
  completeAssignmentIdempotent(input: {
    assignmentId: string;
    assignmentJson: string;
    jobId: string;
    jobJson: string;
    fenceToken: number;
    now: string;
  }): Promise<"completed" | "already_completed" | "rejected">;
};
