import { assertSafeLiveOrchestrationDatabaseUrl, diagnoseOrchestrationEnvFromProcessEnv } from "./orchestration-env-safeguards";
import { isOrchestrationPoolConnectionEnabled } from "./flags";
import { createNeonOrchestrationTransactionalClient } from "./neon-orchestration-client";
import { createPostgresqlOrchestrationSqlPort } from "./postgresql-orchestration-sql-port";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import { verifyOrchestrationStagingDatabaseIdentity } from "./orchestration-staging-identity";

/**
 * Creates a live orchestration SQL port only when CAM_ORCHESTRATION_POOL_ENABLED=true
 * and CAM_ORCHESTRATION_DATABASE_URL is set. Otherwise returns null without connecting.
 */
export async function createOrchestrationSqlPortFromEnv(): Promise<OrchestrationSqlPort | null> {
  if (!isOrchestrationPoolConnectionEnabled()) return null;
  const connectionString = process.env.CAM_ORCHESTRATION_DATABASE_URL?.trim();
  if (!connectionString) return null;
  assertSafeLiveOrchestrationDatabaseUrl(connectionString);
  const envFailure = diagnoseOrchestrationEnvFromProcessEnv().find((row) => !row.ok);
  if (envFailure) {
    throw new Error(envFailure.message);
  }
  const client = createNeonOrchestrationTransactionalClient(connectionString);
  await verifyOrchestrationStagingDatabaseIdentity(client);
  return createPostgresqlOrchestrationSqlPort(client);
}
