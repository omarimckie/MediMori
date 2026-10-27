import {
  CAM_AUDIT_JOB_DO_NOT_TOUCH,
  CAM_COMPLETED_STAGING_JOB_5B,
  diagnoseConsumerRuntimeFlags,
  isProtectedStagingJobId,
  redactAuthorizationHeader,
} from "./consumer-runtime-safety";
import {
  diagnoseOrchestrationEnvFromProcessEnv,
  endpointMarkerInDatabaseUrl,
} from "./orchestration-env-safeguards";
import {
  assertOrchestrationStagingSessionMatches,
  CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID,
  DENIED_ORCHESTRATION_NEON_BRANCH_IDS,
  DENIED_ORCHESTRATION_NEON_PROJECT_IDS,
  resolveOrchestrationStagingIdentityExpectation,
  type OrchestrationStagingSessionObservation,
} from "./orchestration-staging-identity";

export const CAM_STAGING_NEON_BRANCH_ID = "br-wispy-river-b7zzwpij";
export const CAM_STAGING_NEON_ENDPOINT_ID = "ep-bitter-flower-b7cz1fzc";

const TEST_JOB_ID_PATTERN = /^job-staging-5b-consumer-\d{8}-[a-z0-9][a-z0-9-]{0,62}$/i;

export type HarnessDiagnostic = { ok: boolean; code: string; message: string };

export type HarnessMode = "dry_run" | "execute";

export function resolveHarnessMode(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): HarnessMode {
  if (argv.includes("--dry-run")) return "dry_run";
  if (env.CAM_CONSUMER_STAGING_EXECUTE_WRITES === "true") return "execute";
  return "dry_run";
}

export function validateStagingTestJobId(jobId: string | undefined): HarnessDiagnostic | null {
  const trimmed = jobId?.trim() ?? "";
  if (trimmed && isProtectedStagingJobId(trimmed)) {
    return {
      ok: false,
      code: "protected_test_job_id",
      message: "Test job id must not equal a protected staging artifact id.",
    };
  }
  if (!trimmed) {
    return {
      ok: false,
      code: "missing_test_job_id",
      message: "Set CAM_CONSUMER_STAGING_TEST_JOB_ID to a unique Phase 5b consumer test job id.",
    };
  }
  if (!TEST_JOB_ID_PATTERN.test(trimmed)) {
    return {
      ok: false,
      code: "invalid_test_job_id",
      message: "Test job id must match job-staging-5b-consumer-<YYYYMMDD>-<suffix>.",
    };
  }
  return null;
}

export function diagnoseStagingDatabaseUrl(url: string | undefined): HarnessDiagnostic[] {
  const diagnostics: HarnessDiagnostic[] = [];
  const trimmed = url?.trim() ?? "";
  if (!trimmed) {
    diagnostics.push({
      ok: false,
      code: "missing_database_url",
      message: "CAM_ORCHESTRATION_DATABASE_URL is required for staging execution.",
    });
    return diagnostics;
  }
  const deniedMarker = endpointMarkerInDatabaseUrl(trimmed);
  if (deniedMarker) {
    diagnostics.push({
      ok: false,
      code: "denied_database_endpoint",
      message: `Database URL targets a denied endpoint marker (${deniedMarker}).`,
    });
  }
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    if (!host.includes(CAM_STAGING_NEON_ENDPOINT_ID)) {
      diagnostics.push({
        ok: false,
        code: "unexpected_staging_endpoint_host",
        message: `Database host must include staging endpoint id ${CAM_STAGING_NEON_ENDPOINT_ID}.`,
      });
    }
  } catch {
    diagnostics.push({ ok: false, code: "invalid_database_url", message: "Database URL is not parseable." });
  }
  return diagnostics;
}

export function diagnoseStagingIdentityExpectations(
  env: Record<string, string | undefined>,
): HarnessDiagnostic[] {
  const diagnostics: HarnessDiagnostic[] = [];
  const project = env.CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID?.trim();
  const branch = env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID?.trim();
  if (project !== CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID) {
    diagnostics.push({
      ok: false,
      code: "wrong_expected_project",
      message: `CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID must be ${CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID}.`,
    });
  }
  if (branch !== CAM_STAGING_NEON_BRANCH_ID) {
    diagnostics.push({
      ok: false,
      code: "wrong_expected_branch",
      message: `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID must be ${CAM_STAGING_NEON_BRANCH_ID}.`,
    });
  }
  if (branch && DENIED_ORCHESTRATION_NEON_BRANCH_IDS.has(branch)) {
    diagnostics.push({
      ok: false,
      code: "denied_branch",
      message: "Expected branch id is on the disposable/denied list.",
    });
  }
  if (project && DENIED_ORCHESTRATION_NEON_PROJECT_IDS.has(project)) {
    diagnostics.push({
      ok: false,
      code: "denied_project",
      message: "Expected project id is on the denied list.",
    });
  }
  return diagnostics;
}

export function diagnoseConsumerAgentRegistration(
  env: Record<string, string | undefined>,
): HarnessDiagnostic | null {
  const agentId = env.CAM_CONSUMER_STAGING_AGENT_ID?.trim();
  if (!agentId) {
    return {
      ok: false,
      code: "missing_consumer_agent_id",
      message:
        "Set CAM_CONSUMER_STAGING_AGENT_ID to the registered orchestration agent id before execution (e.g. agent-staging-5b).",
    };
  }
  return null;
}

export function runStagingAcceptancePreflight(input: {
  env: Record<string, string | undefined>;
  mode: HarnessMode;
}): HarnessDiagnostic[] {
  const lines: HarnessDiagnostic[] = [];
  const { env, mode } = input;

  if (mode === "execute" && env.CAM_CONSUMER_STAGING_HARNESS_ENABLED !== "true") {
    lines.push({
      ok: false,
      code: "harness_disabled",
      message: "Set CAM_CONSUMER_STAGING_HARNESS_ENABLED=true before staging execution.",
    });
  }

  if (mode === "execute") {
    lines.push(...diagnoseStagingIdentityExpectations(env));
  } else {
    const project = env.CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID?.trim();
    const branch = env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID?.trim();
    if (project && project !== CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID) {
      lines.push({
        ok: false,
        code: "wrong_expected_project",
        message: `CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID must be ${CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID} when set.`,
      });
    }
    if (branch && branch !== CAM_STAGING_NEON_BRANCH_ID) {
      lines.push({
        ok: false,
        code: "wrong_expected_branch",
        message: `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID must be ${CAM_STAGING_NEON_BRANCH_ID} when set.`,
      });
    }
  }

  if (mode === "execute") {
    const testJobDiag = validateStagingTestJobId(env.CAM_CONSUMER_STAGING_TEST_JOB_ID);
    if (testJobDiag) lines.push(testJobDiag);
  }

  if (!isProtectedStagingJobId(CAM_AUDIT_JOB_DO_NOT_TOUCH)) {
    lines.push({ ok: false, code: "audit_guard", message: "Audit job guard misconfigured." });
  }
  if (!isProtectedStagingJobId(CAM_COMPLETED_STAGING_JOB_5B)) {
    lines.push({ ok: false, code: "completed_job_guard", message: "Completed 5b job guard misconfigured." });
  }

  const consumer = diagnoseConsumerRuntimeFlags(env);
  if (mode === "execute" && !consumer.consumerEnabled) {
    lines.push({
      ok: false,
      code: "consumer_disabled",
      message: "Enable CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED for staging execution.",
    });
  }
  if (!consumer.bearerConfigured && mode === "execute") {
    lines.push({
      ok: false,
      code: "bearer_missing",
      message: "CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON is required for staging execution.",
    });
  }
  if (consumer.bridgeEnabled || consumer.schedulerClaimsEnabled) {
    lines.push({ ok: false, code: "forbidden_flags", message: "Bridge and scheduler claims must be off." });
  }
  if (env.CURSOR_API_KEY?.trim()) {
    lines.push({ ok: false, code: "cursor_api_key_set", message: "CURSOR_API_KEY must not be set." });
  }

  if (mode === "execute") {
    lines.push(...diagnoseStagingDatabaseUrl(env.CAM_ORCHESTRATION_DATABASE_URL));
    const agentDiag = diagnoseConsumerAgentRegistration(env);
    if (agentDiag) lines.push(agentDiag);
  }

  for (const row of diagnoseOrchestrationEnvFromProcessEnv(env)) {
    lines.push(row);
  }

  if (mode === "dry_run") {
    lines.push({
      ok: true,
      code: "dry_run_mode",
      message: "Dry-run only — no HTTP or database writes. Pass --execute with CAM_CONSUMER_STAGING_EXECUTE_WRITES=true when owner-authorized.",
    });
  }

  return lines;
}

export function assertStagingSessionObservation(
  observation: OrchestrationStagingSessionObservation,
  env: Record<string, string | undefined>,
): HarnessDiagnostic[] {
  const expected = resolveOrchestrationStagingIdentityExpectation(env);
  if (!expected) {
    return [
      {
        ok: false,
        code: "missing_identity_expectation",
        message: "CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID is required before identity verification.",
      },
    ];
  }
  try {
    assertOrchestrationStagingSessionMatches(observation, expected);
    return [{ ok: true, code: "identity_match", message: "Database identity matches configured staging expectation." }];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database identity mismatch.";
    return [{ ok: false, code: "identity_mismatch", message }];
  }
}

export function redactHarnessEvidence<T extends Record<string, unknown>>(evidence: T): T {
  const clone = JSON.parse(JSON.stringify(evidence)) as T;
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key.toLowerCase() === "authorization" && typeof child === "string") {
          out[key] = redactAuthorizationHeader(child);
        } else if (/password|secret|token|cookie|database_url/i.test(key)) {
          out[key] = "[redacted]";
        } else {
          out[key] = scrub(child);
        }
      }
      return out;
    }
    if (typeof value === "string" && value.toLowerCase().startsWith("bearer ")) {
      return redactAuthorizationHeader(value);
    }
    return value;
  };
  return scrub(clone) as T;
}

export function shouldStopOnHttpResponse(status: number, expected: number | readonly number[]): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected];
  return !allowed.includes(status);
}
