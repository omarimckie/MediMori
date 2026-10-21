/** Minimal engineering status types for read-only central-agent-status projection. */

export const engineeringStatuses = [
  "intake",
  "analyzing",
  "planned",
  "awaiting_approval",
  "implementing",
  "validating",
  "repairing",
  "reviewing",
  "awaiting_merge",
  "merging",
  "completed",
  "blocked",
  "cancelled",
  "escalated",
] as const;

export type EngineeringStatus = (typeof engineeringStatuses)[number];

export type StatusPlan = {
  summary: string;
  files?: string[];
  validations?: string[];
  operations?: string[];
};

export type StatusExecutionAttempt = {
  id: string;
  attemptNumber: number;
  planVersion: number;
  startedAt: string;
  finishedAt: string | null;
  disposition: string;
  modelCalls: number;
  tokens: number;
  costUsd: string;
  workerEnabled?: boolean;
  workerLeaseActive?: boolean;
};

export type StatusMergeReview = {
  approvalStatus: string;
};

export type StatusTask = {
  id: string;
  status: EngineeringStatus;
  plan: StatusPlan | null;
  updated_at?: string;
  attempts?: StatusExecutionAttempt[];
  mergeReview?: StatusMergeReview | null;
};
