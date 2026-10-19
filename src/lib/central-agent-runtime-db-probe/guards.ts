import {
  FIXED_RELEASE_GIT_REF,
  FIXED_STAGING_NEON_BRANCH_ID,
} from "./constants";

export const CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV =
  "CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID";
export const CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV =
  "CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export type ProbeGuardFailure = {
  status: 503;
  error: string;
};

/** Fail-closed preflight before bearer validation or database access. */
export type ProbeEnv = Readonly<Record<string, string | undefined>>;

export function evaluateRuntimeDbProbePreflightGuards(
  env: ProbeEnv = process.env,
): ProbeGuardFailure | null {
  if (env.VERCEL_ENV !== "preview") {
    return { status: 503, error: "Runtime database probe is unavailable." };
  }

  const actualGitRef = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!actualGitRef || actualGitRef !== FIXED_RELEASE_GIT_REF) {
    return { status: 503, error: "Runtime database probe is unavailable." };
  }

  const configuredGitRef = env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]?.trim();
  if (!configuredGitRef || configuredGitRef !== FIXED_RELEASE_GIT_REF) {
    return { status: 503, error: "Runtime database probe is unavailable." };
  }

  const configuredBranchId =
    env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]?.trim();
  if (!configuredBranchId || configuredBranchId !== FIXED_STAGING_NEON_BRANCH_ID) {
    return { status: 503, error: "Runtime database probe is unavailable." };
  }

  return null;
}

export function probeGuardFailureResponse(failure: ProbeGuardFailure): Response {
  return Response.json({ error: failure.error }, { status: failure.status, headers: NO_STORE });
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

export function probeUnavailableResponse(): Response {
  return Response.json(
    { error: "Runtime database probe is unavailable." },
    { status: 503, headers: NO_STORE },
  );
}

export function probeIdentityMismatchResponse(): Response {
  return Response.json(
    { error: "Branch identity mismatch." },
    { status: 503, headers: NO_STORE },
  );
}
