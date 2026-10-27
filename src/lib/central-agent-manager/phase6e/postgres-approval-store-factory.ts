import { createMemoryApprovalStore, unavailableApprovalStore, type TrustedApprovalStore } from "../supervisor/trusted-approval";
import { resolveExplicitAdapterIdentity } from "../adapter/explicit-config";
import { createPostgresApprovalStoreFromIdentity } from "../adapter/postgres-approval-store";
import type { ApprovalConnectionLifecycle } from "../adapter/approval-persistence-port";
import { trustedTargetFromIdentity } from "../adapter/trusted-connection-target";
import { createNeonOrchestrationTransactionalClient } from "../orchestration/neon-orchestration-client";
import type { ApprovalSessionObservation } from "../adapter/identity-guards";
import type { ApprovalDatabaseIdentityConfig } from "../adapter/identity-guards";
import { createSqlPersistedApprovalPorts } from "../phase6f/sql-persisted-approval-ports";
import type { PostgresqlTransactionalClient } from "../orchestration/postgresql-sql-client";

/**
 * Guarded wiring for PostgresApprovalStore. SQL persistence functions are not applied on PGlite;
 * delegate mode uses in-memory ports behind identity/session gates for handler integration tests only.
 */
export function resolvePostgresApprovalStoreFromEnv(
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
  if (env.CAM_APPROVAL_USE_POSTGRES_STORE !== "true") {
    return unavailableApprovalStore;
  }
  const identity = resolveExplicitAdapterIdentityFromEnv(env);
  if (!identity) {
    return unavailableApprovalStore;
  }
  const trustedTarget = trustedTargetFromIdentity(identity);
  const lifecycle = createDisposableApprovalLifecycle(env, identity);
  if (env.CAM_APPROVAL_POSTGRES_DELEGATE_MEMORY === "true") {
    const memory = createMemoryApprovalStore();
    return createPostgresApprovalStoreFromIdentity(identity, {
      lifecycle,
      authority: {
        readTask: (id) => memory.readTask(id),
        saveTask: (task) => memory.saveTask(task),
        commitApproval: (attempt) => memory.commitApproval(attempt),
        readApproval: (id) => memory.readApproval(id),
        revokeApproval: (id, revokedAt) => memory.revokeApproval(id, revokedAt),
      },
      executor: {
        readTask: (id) => memory.readTask(id),
        readApproval: (id) => memory.readApproval(id),
        markTaskRunning: (attempt) => memory.markTaskRunning(attempt),
      },
      attemptedAuthorityTarget: trustedTarget,
      attemptedExecutorTarget: trustedTarget,
    });
  }
  const client = createNeonOrchestrationTransactionalClient(databaseUrl);
  return createPostgresApprovalStoreWithSqlClient({ client, identity, lifecycle, trustedTarget });
}

export function createPostgresApprovalStoreWithSqlClient(input: {
  client: PostgresqlTransactionalClient;
  identity: ApprovalDatabaseIdentityConfig;
  lifecycle: ApprovalConnectionLifecycle;
  trustedTarget: ReturnType<typeof trustedTargetFromIdentity>;
}): TrustedApprovalStore {
  const ports = createSqlPersistedApprovalPorts(input.client);
  return createPostgresApprovalStoreFromIdentity(input.identity, {
    lifecycle: input.lifecycle,
    authority: ports.authority,
    executor: ports.executor,
    attemptedAuthorityTarget: input.trustedTarget,
    attemptedExecutorTarget: input.trustedTarget,
  });
}

function resolveExplicitAdapterIdentityFromEnv(env: Record<string, string | undefined>) {
  const previous = {
    CAM_APPROVAL_PROJECT_ID: process.env.CAM_APPROVAL_PROJECT_ID,
    CAM_APPROVAL_BRANCH_ID: process.env.CAM_APPROVAL_BRANCH_ID,
    CAM_APPROVAL_DATABASE_NAME: process.env.CAM_APPROVAL_DATABASE_NAME,
    CAM_APPROVAL_ENDPOINT_ID: process.env.CAM_APPROVAL_ENDPOINT_ID,
  };
  process.env.CAM_APPROVAL_PROJECT_ID = env.CAM_APPROVAL_PROJECT_ID;
  process.env.CAM_APPROVAL_BRANCH_ID = env.CAM_APPROVAL_BRANCH_ID;
  process.env.CAM_APPROVAL_DATABASE_NAME = env.CAM_APPROVAL_DATABASE_NAME;
  process.env.CAM_APPROVAL_ENDPOINT_ID = env.CAM_APPROVAL_ENDPOINT_ID;
  const identity = resolveExplicitAdapterIdentity();
  process.env.CAM_APPROVAL_PROJECT_ID = previous.CAM_APPROVAL_PROJECT_ID;
  process.env.CAM_APPROVAL_BRANCH_ID = previous.CAM_APPROVAL_BRANCH_ID;
  process.env.CAM_APPROVAL_DATABASE_NAME = previous.CAM_APPROVAL_DATABASE_NAME;
  process.env.CAM_APPROVAL_ENDPOINT_ID = previous.CAM_APPROVAL_ENDPOINT_ID;
  return identity;
}

function createDisposableApprovalLifecycle(
  env: Record<string, string | undefined>,
  identity: NonNullable<ReturnType<typeof resolveExplicitAdapterIdentity>>,
): ApprovalConnectionLifecycle {
  const url = env.CAM_APPROVAL_DISPOSABLE_DATABASE_URL!.trim();
  const client = createNeonOrchestrationTransactionalClient(url);
  const observation = (): ApprovalSessionObservation => ({
    projectId: identity.projectId,
    branchId: identity.branchId,
    databaseName: identity.databaseName,
    host: identity.host,
    sessionUser: identity.authorityRole,
    currentDatabase: identity.databaseName,
    neonBranchId: identity.branchId,
  });
  return {
    beforeAuthorityConnect() {},
    beforeExecutorConnect() {},
    async observeAuthoritySession() {
      await client.query("SELECT 1");
      return { ...observation(), sessionUser: identity.authorityRole };
    },
    async observeExecutorSession() {
      await client.query("SELECT 1");
      return { ...observation(), sessionUser: identity.executorRole };
    },
  };
}
