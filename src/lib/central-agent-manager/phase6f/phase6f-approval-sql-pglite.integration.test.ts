import assert from "node:assert/strict";
import test from "node:test";
import { createCamPgliteBundle } from "../phase6e/cam-pglite-schema";
import { createPostgresApprovalStoreWithSqlClient } from "../phase6e/postgres-approval-store-factory";
import { createSupervisorTask } from "../supervisor/task";
import { trustedTargetFromIdentity } from "../adapter/trusted-connection-target";

const identity = {
  projectId: "aged-brook-70202332",
  branchId: "br-verify-disposable-01",
  databaseName: "neondb",
  host: "ep-verify-disposable-01",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
};

const now = "2026-10-27T14:30:00.000Z";

test("PGlite SQL snapshot approval store survives restart", async () => {
  const bundle = await createCamPgliteBundle();
  const lifecycle = {
    beforeAuthorityConnect() {},
    beforeExecutorConnect() {},
    async observeAuthoritySession() {
      return {
        projectId: identity.projectId,
        branchId: identity.branchId,
        databaseName: identity.databaseName,
        host: identity.host,
        sessionUser: identity.authorityRole,
        currentDatabase: identity.databaseName,
        neonBranchId: identity.branchId,
      };
    },
    async observeExecutorSession() {
      return {
        projectId: identity.projectId,
        branchId: identity.branchId,
        databaseName: identity.databaseName,
        host: identity.host,
        sessionUser: identity.executorRole,
        currentDatabase: identity.databaseName,
        neonBranchId: identity.branchId,
      };
    },
  };
  const storeA = createPostgresApprovalStoreWithSqlClient({
    client: bundle.client,
    identity,
    lifecycle,
    trustedTarget: trustedTargetFromIdentity(identity),
  });
  const task = createSupervisorTask({
    id: "task-sql-1",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "SQL persistence smoke",
    requestedOperations: ["prepare_plan"],
    idempotencyKey: "plan-1",
    now,
  });
  await storeA.saveTask(task);
  const storeB = createPostgresApprovalStoreWithSqlClient({
    client: bundle.client,
    identity,
    lifecycle,
    trustedTarget: trustedTargetFromIdentity(identity),
  });
  const reloaded = await storeB.readTask("task-sql-1");
  assert.ok(reloaded);
  assert.equal(reloaded.id, "task-sql-1");
});
