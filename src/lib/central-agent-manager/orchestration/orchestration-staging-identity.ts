/**
 * Fail-closed CAM orchestration staging identity (offline validation + post-connect assertion).
 * Identity is determined from database-reported Neon settings, not from connection URL hostnames.
 */

import type { PostgresqlSqlClient } from "./postgresql-sql-client";

/** CAM staging Neon project (`central-agent-manager-staging`). */
export const CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID = "aged-brook-70202332";

/** Branches that must never be targeted for live orchestration queue writes. */
export const DENIED_ORCHESTRATION_NEON_BRANCH_IDS = new Set([
  "br-withered-dream-b71r3mo0",
  "br-little-art-au7ke21s",
  "br-quiet-fire-ausvjkg8",
]);

/** Projects that must never host the orchestration queue. */
export const DENIED_ORCHESTRATION_NEON_PROJECT_IDS = new Set(["solitary-leaf-77946642"]);

export const ORCHESTRATION_STAGING_IDENTITY_PROBE_SQL = `
SELECT
  current_setting('neon.project_id', true) AS neon_project_id,
  current_setting('neon.branch_id', true) AS neon_branch_id,
  current_database() AS current_database
`.trim();

export type OrchestrationStagingSessionObservation = {
  neonProjectId: string;
  neonBranchId: string;
  currentDatabase: string;
};

export type OrchestrationStagingIdentityExpectation = {
  projectId: string;
  branchId: string;
};

export type OrchestrationStagingIdentityDiagnostic = {
  ok: boolean;
  code: string;
  message: string;
};

const NEON_PROJECT_ID_PATTERN = /^[a-z]+-[a-z]+-\d{8}$/;
const NEON_BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;

export function isNeonProjectIdFormat(value: string): boolean {
  return NEON_PROJECT_ID_PATTERN.test(value.trim());
}

export function isNeonBranchIdFormat(value: string): boolean {
  return NEON_BRANCH_ID_PATTERN.test(value.trim());
}

export function resolveOrchestrationStagingIdentityExpectation(
  env: Record<string, string | undefined>,
): OrchestrationStagingIdentityExpectation | null {
  const projectId =
    env.CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID?.trim() || CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID;
  const branchId = env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID?.trim();
  if (!branchId) return null;
  return { projectId, branchId };
}

export function diagnoseOrchestrationStagingIdentityEnv(
  env: Record<string, string | undefined>,
  options?: { poolEnabled?: boolean; liveDatabaseUrl?: string },
): OrchestrationStagingIdentityDiagnostic[] {
  const diagnostics: OrchestrationStagingIdentityDiagnostic[] = [];
  const poolEnabled = options?.poolEnabled ?? env.CAM_ORCHESTRATION_POOL_ENABLED === "true";
  const live = (options?.liveDatabaseUrl ?? env.CAM_ORCHESTRATION_DATABASE_URL)?.trim() ?? "";
  const expectation = resolveOrchestrationStagingIdentityExpectation(env);

  if (poolEnabled && live && !expectation) {
    diagnostics.push({
      ok: false,
      code: "missing_expected_neon_branch_id",
      message:
        "CAM_ORCHESTRATION_POOL_ENABLED with a live URL requires CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID (provisioned staging branch).",
    });
  }

  const configuredProject = env.CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID?.trim();
  if (configuredProject && !isNeonProjectIdFormat(configuredProject)) {
    diagnostics.push({
      ok: false,
      code: "invalid_expected_neon_project_id",
      message: "CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID is not a valid Neon project id format.",
    });
  }

  const configuredBranch = env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID?.trim();
  if (configuredBranch) {
    if (!isNeonBranchIdFormat(configuredBranch)) {
      diagnostics.push({
        ok: false,
        code: "invalid_expected_neon_branch_id",
        message: "CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID is not a valid Neon branch id format.",
      });
    }
    if (DENIED_ORCHESTRATION_NEON_BRANCH_IDS.has(configuredBranch)) {
      diagnostics.push({
        ok: false,
        code: "denied_expected_neon_branch_id",
        message: `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID targets a denied branch (${configuredBranch}).`,
      });
    }
  }

  if (expectation) {
    if (DENIED_ORCHESTRATION_NEON_PROJECT_IDS.has(expectation.projectId)) {
      diagnostics.push({
        ok: false,
        code: "denied_expected_neon_project_id",
        message: "CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID targets a denied Neon project.",
      });
    }
    if (!isNeonProjectIdFormat(expectation.projectId)) {
      diagnostics.push({
        ok: false,
        code: "invalid_resolved_neon_project_id",
        message: "Resolved orchestration staging project id format is invalid.",
      });
    }
  }

  return diagnostics;
}

function requiredNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Orchestration staging identity observation missing ${label}.`);
  }
  return value.trim();
}

export function parseOrchestrationStagingSessionObservationRow(
  row: Record<string, unknown> | undefined,
): OrchestrationStagingSessionObservation {
  if (!row) {
    throw new Error("Orchestration staging identity probe returned no rows.");
  }
  return {
    neonProjectId: requiredNonEmpty(row.neon_project_id, "neon.project_id"),
    neonBranchId: requiredNonEmpty(row.neon_branch_id, "neon.branch_id"),
    currentDatabase: requiredNonEmpty(row.current_database, "current_database"),
  };
}

export function assertOrchestrationStagingSessionMatches(
  observed: OrchestrationStagingSessionObservation,
  expected: OrchestrationStagingIdentityExpectation,
): void {
  if (DENIED_ORCHESTRATION_NEON_PROJECT_IDS.has(observed.neonProjectId)) {
    throw new Error("Orchestration database reported a denied Neon project id.");
  }
  if (DENIED_ORCHESTRATION_NEON_BRANCH_IDS.has(observed.neonBranchId)) {
    throw new Error("Orchestration database reported a denied Neon branch id.");
  }
  if (observed.neonProjectId !== expected.projectId) {
    throw new Error("Orchestration database neon.project_id does not match configured expectation.");
  }
  if (observed.neonBranchId !== expected.branchId) {
    throw new Error("Orchestration database neon.branch_id does not match configured expectation.");
  }
}

export async function verifyOrchestrationStagingDatabaseIdentity(
  client: PostgresqlSqlClient,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<void> {
  const expected = resolveOrchestrationStagingIdentityExpectation(env);
  if (!expected) {
    throw new Error(
      "CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID is required before opening the orchestration pool.",
    );
  }
  const identityDiagnostics = diagnoseOrchestrationStagingIdentityEnv(env);
  const failed = identityDiagnostics.find((row) => !row.ok);
  if (failed) {
    throw new Error(failed.message);
  }
  const result = await client.query<{
    neon_project_id: string;
    neon_branch_id: string;
    current_database: string;
  }>(ORCHESTRATION_STAGING_IDENTITY_PROBE_SQL);
  const observed = parseOrchestrationStagingSessionObservationRow(result.rows[0]);
  assertOrchestrationStagingSessionMatches(observed, expected);
}
