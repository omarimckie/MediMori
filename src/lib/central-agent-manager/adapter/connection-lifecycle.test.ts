import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApprovalAuthorityPersistencePort,
  ApprovalConnectionLifecycle,
  ApprovalExecutorPersistencePort,
} from "./approval-persistence-port";
import { createSupervisorTask } from "../supervisor/task";
import { createPostgresApprovalStore } from "./postgres-approval-store";
import { trustedTargetFromIdentity } from "./trusted-connection-target";

const identity = {
  projectId: "aged-brook-70202332",
  branchId: "br-lifecycle-disposable-01",
  databaseName: "neondb",
  host: "ep-lifecycle-disposable-01",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
};

const trusted = trustedTargetFromIdentity(identity);

function observation(role: string) {
  return {
    projectId: identity.projectId,
    branchId: identity.branchId,
    databaseName: identity.databaseName,
    host: identity.host,
    sessionUser: role,
    currentDatabase: identity.databaseName,
    neonBranchId: identity.branchId,
  };
}

test("failed authority preflight invokes cleanup hook and does not cache session", async () => {
  let authorityConnects = 0;
  let authorityFailures = 0;
  let observeCalls = 0;
  const lifecycle: ApprovalConnectionLifecycle = {
    beforeAuthorityConnect() {
      authorityConnects += 1;
    },
    beforeExecutorConnect() {},
    afterAuthorityConnectFailed() {
      authorityFailures += 1;
    },
    async observeAuthoritySession() {
      observeCalls += 1;
      if (observeCalls === 1) {
        return { ...observation(identity.authorityRole), neonBranchId: "br-spoofed" };
      }
      return observation(identity.authorityRole);
    },
    async observeExecutorSession() {
      return observation(identity.executorRole);
    },
  };
  const authority: ApprovalAuthorityPersistencePort = {
    readTask: async () => null,
    saveTask: async () => {},
    commitApproval: async () => {
      throw new Error("unreachable");
    },
    readApproval: async () => null,
    revokeApproval: async () => null,
  };
  const executor: ApprovalExecutorPersistencePort = {
    readTask: async () => null,
    readApproval: async () => null,
    markTaskRunning: async () => {
      throw new Error("unreachable");
    },
  };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget: trusted,
    attemptedAuthorityTarget: trusted,
    attemptedExecutorTarget: trusted,
    lifecycle,
    authority,
    executor,
  });
  await assert.rejects(() => store.readTask("task-1"), /rejected/);
  assert.equal(authorityFailures, 1);
  assert.equal(authorityConnects, 1);
  await store.readTask("task-2");
  assert.equal(authorityConnects, 2);
  assert.equal(observeCalls, 2);
});

test("authority gate caches verification until identity invalidation (driver must bind connection to gate)", async () => {
  let observeCalls = 0;
  const lifecycle: ApprovalConnectionLifecycle = {
    beforeAuthorityConnect() {},
    beforeExecutorConnect() {},
    async observeAuthoritySession() {
      observeCalls += 1;
      if (observeCalls > 1) {
        return { ...observation(identity.authorityRole), neonBranchId: "br-replaced-session" };
      }
      return observation(identity.authorityRole);
    },
    async observeExecutorSession() {
      return observation(identity.executorRole);
    },
  };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget: trusted,
    attemptedAuthorityTarget: trusted,
    attemptedExecutorTarget: trusted,
    lifecycle,
    authority: {
      readTask: async () => null,
      saveTask: async () => {},
      commitApproval: async () => {
        throw new Error("unreachable");
      },
      readApproval: async () => null,
      revokeApproval: async () => null,
    },
    executor: {
      readTask: async () => null,
      readApproval: async () => null,
      markTaskRunning: async () => {
        throw new Error("unreachable");
      },
    },
  });
  await store.readTask("task-a");
  await store.readTask("task-b");
  assert.equal(observeCalls, 1);
});

test("executor path cannot reuse authority gate for privileged writes", async () => {
  let authorityWrites = 0;
  const lifecycle: ApprovalConnectionLifecycle = {
    beforeAuthorityConnect() {},
    beforeExecutorConnect() {},
    async observeAuthoritySession() {
      return observation(identity.authorityRole);
    },
    async observeExecutorSession() {
      return {
        ...observation(identity.executorRole),
        sessionUser: identity.authorityRole,
      };
    },
  };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget: trusted,
    attemptedAuthorityTarget: trusted,
    attemptedExecutorTarget: trusted,
    lifecycle,
    authority: {
      readTask: async () => {
        authorityWrites += 1;
        return null;
      },
      saveTask: async () => {
        authorityWrites += 1;
      },
      commitApproval: async () => {
        authorityWrites += 1;
        throw new Error("unreachable");
      },
      readApproval: async () => null,
      revokeApproval: async () => null,
    },
    executor: {
      readTask: async () => null,
      readApproval: async () => null,
      markTaskRunning: async () => {
        throw new Error("unreachable");
      },
    },
  });
  const usage = createSupervisorTask({
    id: "task-1",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "x",
    requestedOperations: ["merge_main"],
    idempotencyKey: "idem-1",
    planVersion: 1,
    now: "2026-10-21T20:00:00.000Z",
  }).usage;
  await assert.rejects(
    () =>
      store.markTaskRunning({
        taskId: "task-1",
        operation: "merge_main",
        environment: "local",
        now: "2026-10-21T20:00:00.000Z",
        usage,
      }),
    /rejected|executor/i,
  );
  assert.equal(authorityWrites, 0);
});
