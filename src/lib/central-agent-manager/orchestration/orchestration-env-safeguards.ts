/**
 * Offline staging configuration guards for CAM orchestration database URLs.
 * Endpoint deny lists are a first line of defense only; live identity uses database-reported Neon ids.
 */
import { diagnoseOrchestrationStagingIdentityEnv } from "./orchestration-staging-identity";

export type OrchestrationEnvDiagnostic = {
  ok: boolean;
  code: string;
  message: string;
};

/** Endpoint host id substrings that must not be used for CAM_ORCHESTRATION_DATABASE_URL. */
export const DENIED_LIVE_ORCHESTRATION_ENDPOINT_MARKERS = [
  "ep-gentle-dawn-au6vxirn",
  "ep-muddy-math-auxmesyz",
  "ep-nameless-dream-b7hvelbo",
] as const;

export function endpointMarkerInDatabaseUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const marker of DENIED_LIVE_ORCHESTRATION_ENDPOINT_MARKERS) {
      if (host.includes(marker)) return marker;
    }
    return null;
  } catch {
    return null;
  }
}

export function diagnoseOrchestrationEnv(input: {
  poolEnabled: boolean;
  liveDatabaseUrl?: string;
  disposableDatabaseUrl?: string;
}): OrchestrationEnvDiagnostic[] {
  const diagnostics: OrchestrationEnvDiagnostic[] = [];
  const live = input.liveDatabaseUrl?.trim() ?? "";
  const disposable = input.disposableDatabaseUrl?.trim() ?? "";

  if (input.poolEnabled && !live) {
    diagnostics.push({
      ok: false,
      code: "missing_live_database_url",
      message:
        "CAM_ORCHESTRATION_POOL_ENABLED is true but CAM_ORCHESTRATION_DATABASE_URL is unset.",
    });
  }

  if (!input.poolEnabled && live) {
    diagnostics.push({
      ok: false,
      code: "live_url_without_pool",
      message:
        "CAM_ORCHESTRATION_DATABASE_URL is set but CAM_ORCHESTRATION_POOL_ENABLED is not true; the app will not use the live URL.",
    });
  }

  if (live && disposable && live === disposable) {
    diagnostics.push({
      ok: false,
      code: "disposable_equals_live",
      message:
        "CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL must not be the same as CAM_ORCHESTRATION_DATABASE_URL.",
    });
  }

  if (live) {
    const denied = endpointMarkerInDatabaseUrl(live);
    if (denied) {
      diagnostics.push({
        ok: false,
        code: "denied_live_endpoint",
        message: `CAM_ORCHESTRATION_DATABASE_URL targets a denied endpoint (${denied}). Use a dedicated staging branch on aged-brook-70202332.`,
      });
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      ok: true,
      code: "ok",
      message: "Orchestration environment configuration is consistent.",
    });
  }

  return diagnostics;
}

export type OrchestrationEnvReader = Record<string, string | undefined>;

export function diagnoseOrchestrationEnvFromProcessEnv(
  env: OrchestrationEnvReader = process.env as OrchestrationEnvReader,
): OrchestrationEnvDiagnostic[] {
  const poolEnabled = env.CAM_ORCHESTRATION_POOL_ENABLED === "true";
  const live = env.CAM_ORCHESTRATION_DATABASE_URL;
  const base = diagnoseOrchestrationEnv({
    poolEnabled,
    liveDatabaseUrl: live,
    disposableDatabaseUrl: env.CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL,
  });
  const identity = diagnoseOrchestrationStagingIdentityEnv(env, {
    poolEnabled,
    liveDatabaseUrl: live,
  }).filter((row) => !row.ok);
  const merged = [...base.filter((row) => row.code !== "ok"), ...identity];
  if (merged.length === 0) {
    return [
      {
        ok: true,
        code: "ok",
        message: "Orchestration environment configuration is consistent.",
      },
    ];
  }
  return merged.filter((row) => row.code !== "ok");
}

export function assertSafeLiveOrchestrationDatabaseUrl(url: string): void {
  const denied = endpointMarkerInDatabaseUrl(url);
  if (denied) {
    throw new Error(
      `CAM_ORCHESTRATION_DATABASE_URL targets denied endpoint ${denied}; use a dedicated CAM staging branch.`,
    );
  }
}

export function orchestrationEnvIsStagingReady(
  env: OrchestrationEnvReader = process.env as OrchestrationEnvReader,
): boolean {
  const durable = env.CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED === "true";
  const management = env.CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED === "true";
  const pool = env.CAM_ORCHESTRATION_POOL_ENABLED === "true";
  const live = env.CAM_ORCHESTRATION_DATABASE_URL?.trim();
  if (!durable || !management || !pool || !live) return false;
  const branchExpected = env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID?.trim();
  if (!branchExpected) return false;
  return diagnoseOrchestrationEnvFromProcessEnv(env).every((row) => row.ok);
}
