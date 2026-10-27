import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionValue } from "@/lib/admin-auth";
import { centralAgentManagerApprovalResponse } from "../approval-handler";
import { createMemoryApprovalStore, issueTrustedOwnerApproval } from "../supervisor/trusted-approval";
import { createSupervisorTask } from "../supervisor/task";
import type {
  ApprovalAuthorityPersistencePort,
  ApprovalConnectionLifecycle,
  ApprovalExecutorPersistencePort,
} from "./approval-persistence-port";
import { verifyBeforeConnect } from "./connection-preflight";
import { createPostgresApprovalStore } from "./postgres-approval-store";
import { toSafeApprovalAdapterMessage } from "./safe-error";
import { trustedTargetFromIdentity } from "./trusted-connection-target";

const identity = {
  projectId: "aged-brook-70202332",
  branchId: "br-verify-disposable-01",
  databaseName: "neondb",
  host: "ep-verify-disposable-01",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
};

const trustedTarget = trustedTargetFromIdentity(identity);

const now = "2026-10-21T20:00:00.000Z";

function observation(role: string): import("./identity-guards").ApprovalSessionObservation {
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

function createTrackingPorts() {
  let authorityConnects = 0;
  let executorConnects = 0;
  const memory = createMemoryApprovalStore();
  const authority: ApprovalAuthorityPersistencePort = {
    readTask: (id) => memory.readTask(id),
    saveTask: (task) => memory.saveTask(task),
    commitApproval: (attempt) => memory.commitApproval(attempt),
    readApproval: (id) => memory.readApproval(id),
    revokeApproval: (id, revokedAt) => memory.revokeApproval(id, revokedAt),
  };
  const executor: ApprovalExecutorPersistencePort = {
    readTask: (id) => memory.readTask(id),
    readApproval: (id) => memory.readApproval(id),
    markTaskRunning: (attempt) => memory.markTaskRunning(attempt),
  };
  const lifecycle: ApprovalConnectionLifecycle = {
    beforeAuthorityConnect() {
      authorityConnects += 1;
    },
    beforeExecutorConnect() {
      executorConnects += 1;
    },
    async observeAuthoritySession() {
      return observation(identity.authorityRole);
    },
    async observeExecutorSession() {
      return observation(identity.executorRole);
    },
  };
  return { memory, authority, executor, lifecycle, authorityConnects: () => authorityConnects, executorConnects: () => executorConnects };
}

function storeWithTargets(
  ports: ReturnType<typeof createTrackingPorts>,
  attemptedAuthority = trustedTarget,
  attemptedExecutor = trustedTarget,
) {
  return createPostgresApprovalStore({
    identity,
    trustedTarget,
    attemptedAuthorityTarget: attemptedAuthority,
    attemptedExecutorTarget: attemptedExecutor,
    lifecycle: ports.lifecycle,
    authority: ports.authority,
    executor: ports.executor,
  });
}

test("ADP-1: preflight rejects before privileged connection acquisition", async () => {
  const ports = createTrackingPorts();
  const wrongTarget = { ...trustedTarget, host: "ep-other-disposable-branch" };
  assert.throws(
    () =>
      verifyBeforeConnect({
        identity,
        trustedTarget,
        attemptedTarget: wrongTarget,
      }),
    /rejected/,
  );
  const store = storeWithTargets(ports, wrongTarget, wrongTarget);
  await assert.rejects(() => store.readTask("task-1"), /rejected/);
  assert.equal(ports.authorityConnects(), 0);
  assert.equal(ports.executorConnects(), 0);
});

test("ADP-2: endpoint mismatch is rejected even with spoofed session branch metadata", async () => {
  const ports = createTrackingPorts();
  const spoofedLifecycle: ApprovalConnectionLifecycle = {
    beforeAuthorityConnect: ports.lifecycle.beforeAuthorityConnect,
    beforeExecutorConnect: ports.lifecycle.beforeExecutorConnect,
    async observeAuthoritySession() {
      return {
        ...observation(identity.authorityRole),
        neonBranchId: identity.branchId,
        host: identity.host,
      };
    },
    async observeExecutorSession() {
      return observation(identity.executorRole);
    },
  };
  const wrongHost = { ...trustedTarget, host: "ep-wrong-disposable-endpoint" };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget,
    attemptedAuthorityTarget: wrongHost,
    attemptedExecutorTarget: trustedTarget,
    lifecycle: spoofedLifecycle,
    authority: ports.authority,
    executor: ports.executor,
  });
  await assert.rejects(
    () =>
      store.commitApproval({
        id: "approval-x",
        taskId: "task-x",
        operation: "merge_main",
        planVersion: 1,
        specialistId: "engineering",
        environment: "local",
        ownerUsername: "omari",
        decision: "approved",
        issuedAt: now,
        expiresAt: "2026-10-22T20:00:00.000Z",
        revokedAt: null,
        idempotencyKey: "idem-x",
        expectedPlanVersion: 1,
        expectedPlanDigest: "a".repeat(64),
        expectedTaskPlanDigest: "b".repeat(64),
      }),
    /rejected/,
  );
  assert.equal(ports.authorityConnects(), 0);
});

test("ADP-3: owner authentication is required before approval issuance", async () => {
  const ports = createTrackingPorts();
  const store = storeWithTargets(ports);
  const task = createSupervisorTask({
    id: "task-adp3",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "x",
    requestedOperations: ["merge_main"],
    idempotencyKey: "idem-adp3",
    planVersion: 1,
    now,
  });
  const { transitionTask } = await import("../supervisor/task");
  const waiting = transitionTask(task, "awaiting_approval", now);
  await store.saveTask(waiting);
  await assert.rejects(
    issueTrustedOwnerApproval({
      sessionToken: undefined,
      taskId: task.id,
      operation: "merge_main",
      environment: "local",
      idempotencyKey: "idem-issue",
      store,
      now,
    }),
    /missing/,
  );
  const previousOwners = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari";
  process.env.ADMIN_SESSION_SECRET = previousSecret || "cam-adapter-test-admin-secret-value";
  const ownerToken = createAdminSessionValue("omari");
  const issued = await issueTrustedOwnerApproval({
    sessionToken: ownerToken,
    taskId: task.id,
    operation: "merge_main",
    environment: "local",
    idempotencyKey: "idem-issue",
    store,
    now,
  });
  assert.equal(issued.record.taskId, task.id);
  if (previousOwners === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previousOwners;
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
});

test("authority and executor use separate connection gates", async () => {
  const ports = createTrackingPorts();
  const store = storeWithTargets(ports);
  const task = createSupervisorTask({
    id: "task-role",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "x",
    requestedOperations: ["merge_main"],
    idempotencyKey: "idem-role",
    planVersion: 1,
    now,
  });
  await store.saveTask(task);
  assert.equal(ports.authorityConnects(), 1);
  await assert.rejects(
    store.markTaskRunning({
      taskId: task.id,
      operation: "merge_main",
      environment: "local",
      now,
      usage: task.usage,
    }),
    /execution|approval|eligible|missing/i,
  );
  assert.equal(ports.executorConnects(), 1);
});

test("spoofed neon.branch_id on correct endpoint is rejected", async () => {
  const ports = createTrackingPorts();
  const badLifecycle: ApprovalConnectionLifecycle = {
    ...ports.lifecycle,
    async observeAuthoritySession() {
      return {
        ...observation(identity.authorityRole),
        neonBranchId: "br-spoofed-not-trusted",
      };
    },
  };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget,
    attemptedAuthorityTarget: trustedTarget,
    attemptedExecutorTarget: trustedTarget,
    lifecycle: badLifecycle,
    authority: ports.authority,
    executor: ports.executor,
  });
  await assert.rejects(() => store.readTask("task-1"), /rejected/);
  assert.equal(ports.authorityConnects(), 1);
});

test("safe error projection redacts connection material", () => {
  const message = toSafeApprovalAdapterMessage(
    new Error("connect failed postgres://user:secret@ep-bold-bird.neon.tech/neondb"),
  );
  assert.doesNotMatch(message, /secret/);
  assert.doesNotMatch(message, /postgres:\/\//);
});

test("backend connection errors are projected without credential leakage", async () => {
  const ports = createTrackingPorts();
  const failingAuthority: ApprovalAuthorityPersistencePort = {
    ...ports.authority,
    async readTask() {
      throw new Error("connection failed postgres://user:secret@host/db");
    },
  };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget,
    attemptedAuthorityTarget: trustedTarget,
    attemptedExecutorTarget: trustedTarget,
    lifecycle: ports.lifecycle,
    authority: failingAuthority,
    executor: ports.executor,
  });
  await assert.rejects(async () => store.readTask("task-1"), (error: Error) => {
    assert.match(error.message, /unavailable|redacted|storage/i);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test("approval route still defaults to unavailable store", async () => {
  const body = JSON.stringify({ taskId: "t", operation: "merge_main", idempotencyKey: "k" });
  const response = await centralAgentManagerApprovalResponse(
    new Request("https://manager.local/api", { method: "POST", body }),
    {
      isEnabled: () => true,
      isOwnerConfigured: () => true,
      environment: "local",
      getSessionToken: async () => createAdminSessionValue("omari"),
    },
  );
  assert.equal(response.status, 503);
});
