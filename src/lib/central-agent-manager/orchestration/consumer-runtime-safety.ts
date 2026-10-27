/**
 * Offline operational helpers for agent consumer runtime (no network I/O).
 */

export const CAM_CONSUMER_DEFAULT_DISABLED_MESSAGE =
  "Agent consumer interface is disabled.";

export const CAM_AUDIT_JOB_DO_NOT_TOUCH = "job-staging-5a2b-20261026-om";

/** Phase 5b completed acceptance artifact — do not re-claim or mutate. */
export const CAM_COMPLETED_STAGING_JOB_5B = "job-staging-5b-consumer-20261026-a3";

export function isProtectedStagingAuditJobId(jobId: string): boolean {
  return jobId === CAM_AUDIT_JOB_DO_NOT_TOUCH;
}

export function isProtectedStagingCompletedJobId(jobId: string): boolean {
  return jobId === CAM_COMPLETED_STAGING_JOB_5B;
}

export function isProtectedStagingJobId(jobId: string): boolean {
  return isProtectedStagingAuditJobId(jobId) || isProtectedStagingCompletedJobId(jobId);
}

export function rejectConsumerMutationOnAuditJob(jobId: string | undefined): void {
  if (jobId && isProtectedStagingJobId(jobId)) {
    throw new Error(`Job ${jobId} is a protected staging artifact; consumer must not mutate it.`);
  }
}

export function redactAuthorizationHeader(value: string | null): string {
  if (!value) return "";
  if (value.toLowerCase().startsWith("bearer ")) return "Bearer [redacted]";
  return "[redacted]";
}

export type ConsumerHealthDiagnostic = {
  consumerEnabled: boolean;
  bearerConfigured: boolean;
  bridgeEnabled: boolean;
  schedulerClaimsEnabled: boolean;
};

export function diagnoseConsumerRuntimeFlags(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ConsumerHealthDiagnostic {
  return {
    consumerEnabled: env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED === "true",
    bearerConfigured: Boolean(env.CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON?.trim()),
    bridgeEnabled: env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED === "true",
    schedulerClaimsEnabled: env.CENTRAL_AGENT_MANAGER_DURABLE_SCHEDULER_CLAIMS_ENABLED === "true",
  };
}
