export type ClaimableNotificationStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "exhausted";

export type ClaimableNotificationJob = {
  id: string;
  status: ClaimableNotificationStatus;
  claimToken: string | null;
  nextAttemptAt: number;
  createdAt: number;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
};

export type RecoveryAudit = {
  jobId: string;
  adminUsername: string;
  priorStatus: "exhausted";
  priorAttemptCount: number;
  priorLastError: string | null;
  reason: string;
  createdAt: string;
};

/**
 * Mirrors one atomic UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)
 * WHERE status = 'failed' AND attempt_count < max_attempts.
 * Exhausted jobs and locked rows are skipped.
 */
export function claimDueFailedJobs(input: {
  jobs: ClaimableNotificationJob[];
  now: number;
  limit: number;
  lockedIds: ReadonlySet<string>;
  createToken: () => string;
}): ClaimableNotificationJob[] {
  const selected = input.jobs
    .filter(
      (job) =>
        job.status === "failed" &&
        job.attemptCount < job.maxAttempts &&
        job.nextAttemptAt <= input.now &&
        !input.lockedIds.has(job.id),
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, input.limit);

  const claimed: ClaimableNotificationJob[] = [];
  for (const job of selected) {
    if (
      job.status !== "failed" ||
      job.attemptCount >= job.maxAttempts ||
      input.lockedIds.has(job.id)
    ) {
      continue;
    }
    job.status = "sending";
    job.claimToken = input.createToken();
    job.attemptCount += 1;
    claimed.push({ ...job });
  }
  return claimed;
}

export function markClaimedJobSent(
  job: ClaimableNotificationJob,
  claimToken: string,
): boolean {
  if (job.status !== "sending" || job.claimToken !== claimToken) return false;
  job.status = "sent";
  job.claimToken = null;
  return true;
}

export function markClaimedJobFailed(
  job: ClaimableNotificationJob,
  claimToken: string,
  error?: string,
): boolean {
  if (job.status !== "sending" || job.claimToken !== claimToken) return false;
  job.status = job.attemptCount >= job.maxAttempts ? "exhausted" : "failed";
  job.claimToken = null;
  if (error !== undefined) job.lastError = error;
  return true;
}

/**
 * Returns an interrupted send to the retry queue without a second attempt increment
 * and without replacing last_error. A claim that already reached the cap is exhausted.
 */
export function reclaimStaleSendingJobs(
  jobs: ClaimableNotificationJob[],
  updatedAt: Map<string, number>,
  staleBefore: number,
): number {
  let reclaimed = 0;
  for (const job of jobs) {
    const touchedAt = updatedAt.get(job.id) ?? 0;
    if (job.status !== "sending" || touchedAt >= staleBefore) continue;
    job.status = job.attemptCount >= job.maxAttempts ? "exhausted" : "failed";
    job.claimToken = null;
    reclaimed += 1;
  }
  return reclaimed;
}

/**
 * Mirrors the recovery CTE: the audit row is recorded only when the exhausted,
 * unclaimed job is updated. A second caller sees the new status and writes nothing.
 */
export function recoverExhaustedJob(input: {
  job: ClaimableNotificationJob;
  adminUsername: string;
  reason: string;
  now: string;
  audits: RecoveryAudit[];
}): boolean {
  if (input.job.status !== "exhausted" || input.job.claimToken !== null) return false;
  const audit: RecoveryAudit = {
    jobId: input.job.id,
    adminUsername: input.adminUsername,
    priorStatus: "exhausted",
    priorAttemptCount: input.job.attemptCount,
    priorLastError: input.job.lastError,
    reason: input.reason,
    createdAt: input.now,
  };
  input.job.maxAttempts += 1;
  input.job.status = "failed";
  input.audits.push(audit);
  return true;
}
