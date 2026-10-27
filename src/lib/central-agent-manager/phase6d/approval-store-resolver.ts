import { createMemoryApprovalStore, unavailableApprovalStore, type TrustedApprovalStore } from "../supervisor/trusted-approval";
import { resolvePostgresApprovalStoreFromEnv } from "../phase6e/postgres-approval-store-factory";

/**
 * Live Postgres wiring requires disposable DB URL + owner activation.
 * Routes remain fail-closed unless CAM_APPROVAL_PERSISTENCE_ENABLED=true.
 */
export function resolveTrustedApprovalStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): TrustedApprovalStore {
  if (env.CAM_APPROVAL_PERSISTENCE_ENABLED !== "true") {
    return unavailableApprovalStore;
  }
  const databaseUrl = env.CAM_APPROVAL_DISPOSABLE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return unavailableApprovalStore;
  }
  if (env.CAM_APPROVAL_ALLOW_IN_MEMORY_DISPOSABLE === "true") {
    return createMemoryApprovalStore();
  }
  const postgresStore = resolvePostgresApprovalStoreFromEnv(env);
  if (postgresStore !== unavailableApprovalStore) {
    return postgresStore;
  }
  return unavailableApprovalStore;
}

export function approvalRoutesMayServe(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.CAM_APPROVAL_PERSISTENCE_ENABLED === "true" &&
    Boolean(env.CAM_APPROVAL_DISPOSABLE_DATABASE_URL?.trim()) &&
    env.CAM_APPROVAL_HTTP_ROUTES_ENABLED === "true"
  );
}
