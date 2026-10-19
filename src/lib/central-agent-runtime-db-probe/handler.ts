import {
  isCentralAgentRuntimeDbProbeBearerConfigured,
  isCentralAgentRuntimeDbProbeEnabled,
  verifyCentralAgentRuntimeDbProbeBearer,
} from "./auth";
import {
  FIXED_STAGING_DATABASE_NAME,
  FIXED_STAGING_NEON_BRANCH_ID,
  RUNTIME_DB_PROBE_CONTRACT,
} from "./constants";
import {
  evaluateRuntimeDbProbePreflightGuards,
  probeDisabledResponse,
  probeGuardFailureResponse,
  probeIdentityMismatchResponse,
  probeUnauthorizedResponse,
  probeUnavailableResponse,
} from "./guards";
import {
  fetchRuntimeDatabaseIdentity,
  RuntimeDatabaseIdentityError,
  type RuntimeDatabaseIdentity,
} from "./identity-query";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export type RuntimeDbProbeDeps = {
  isEnabled?: () => boolean;
  isBearerConfigured?: () => boolean;
  verifyBearer?: (request: Request) => boolean;
  evaluatePreflight?: typeof evaluateRuntimeDbProbePreflightGuards;
  fetchIdentity?: () => Promise<RuntimeDatabaseIdentity>;
};

export async function centralAgentRuntimeDbProbeGet(
  request: Request,
  deps: RuntimeDbProbeDeps = {},
): Promise<Response> {
  const isEnabled = deps.isEnabled ?? isCentralAgentRuntimeDbProbeEnabled;
  const isBearerConfigured =
    deps.isBearerConfigured ?? isCentralAgentRuntimeDbProbeBearerConfigured;
  const verifyBearer = deps.verifyBearer ?? verifyCentralAgentRuntimeDbProbeBearer;
  const evaluatePreflight = deps.evaluatePreflight ?? evaluateRuntimeDbProbePreflightGuards;
  const fetchIdentity = deps.fetchIdentity ?? fetchRuntimeDatabaseIdentity;

  if (!isEnabled()) {
    return probeDisabledResponse();
  }

  const preflightFailure = evaluatePreflight();
  if (preflightFailure) {
    return probeGuardFailureResponse(preflightFailure);
  }

  if (!isBearerConfigured()) {
    return probeUnavailableResponse();
  }

  if (!verifyBearer(request)) {
    return probeUnauthorizedResponse();
  }

  try {
    const identity = await fetchIdentity();
    if (
      identity.databaseName !== FIXED_STAGING_DATABASE_NAME ||
      identity.neonBranchId !== FIXED_STAGING_NEON_BRANCH_ID
    ) {
      return probeIdentityMismatchResponse();
    }

    return Response.json(
      {
        probe: RUNTIME_DB_PROBE_CONTRACT,
        ok: true,
        databaseName: identity.databaseName,
        neonBranchId: identity.neonBranchId,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof RuntimeDatabaseIdentityError) {
      return probeIdentityMismatchResponse();
    }
    return probeUnavailableResponse();
  }
}

export function centralAgentRuntimeDbProbeMethodNotAllowed(): Response {
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
  );
}
