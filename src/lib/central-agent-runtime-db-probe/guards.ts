import {
  FIXED_RELEASE_GIT_REF,
  FIXED_STAGING_NEON_BRANCH_ID,
} from "./constants";

export const CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV =
  "CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID";
export const CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV =
  "CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const UNAVAILABLE_ERROR = "Runtime database probe is unavailable." as const;

/** Non-secret machine-readable reasons for authenticated unavailable responses. */
export type ProbeUnavailableReason =
  | "vercel_env"
  | "git_commit_ref"
  | "allowed_git_ref"
  | "expected_branch_id"
  | "bearer_missing"
  | "db_config_missing"
  | "db_connect";

export type ProbeGuardFailure = {
  status: 503;
  error: typeof UNAVAILABLE_ERROR;
  reason: ProbeUnavailableReason;
};

/** Fail-closed preview / allowlist preflight (evaluated only after bearer auth). */
export type ProbeEnv = Readonly<Record<string, string | undefined>>;

export function evaluateRuntimeDbProbePreflightGuards(
  env: ProbeEnv = process.env,
): ProbeGuardFailure | null {
  if (env.VERCEL_ENV !== "preview") {
    return { status: 503, error: UNAVAILABLE_ERROR, reason: "vercel_env" };
  }

  const actualGitRef = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!actualGitRef || actualGitRef !== FIXED_RELEASE_GIT_REF) {
    return { status: 503, error: UNAVAILABLE_ERROR, reason: "git_commit_ref" };
  }

  const configuredGitRef = env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]?.trim();
  if (!configuredGitRef || configuredGitRef !== FIXED_RELEASE_GIT_REF) {
    return { status: 503, error: UNAVAILABLE_ERROR, reason: "allowed_git_ref" };
  }

  const configuredBranchId =
    env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]?.trim();
  if (!configuredBranchId || configuredBranchId !== FIXED_STAGING_NEON_BRANCH_ID) {
    return {
      status: 503,
      error: UNAVAILABLE_ERROR,
      reason: "expected_branch_id",
    };
  }

  return null;
}

export function probeGuardFailureResponse(failure: ProbeGuardFailure): Response {
  return Response.json(
    { error: failure.error, reason: failure.reason },
    { status: failure.status, headers: NO_STORE },
  );
}

export function probeDisabledResponse(): Response {
  return Response.json(
    { error: "Runtime database probe is disabled." },
    { status: 503, headers: NO_STORE },
  );
}

export function probeUnauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
}

export function probeUnavailableResponse(reason: ProbeUnavailableReason): Response {
  return Response.json(
    { error: UNAVAILABLE_ERROR, reason },
    { status: 503, headers: NO_STORE },
  );
}

export function probeIdentityMismatchResponse(): Response {
  return Response.json(
    { error: "Branch identity mismatch." },
    { status: 503, headers: NO_STORE },
  );
}
