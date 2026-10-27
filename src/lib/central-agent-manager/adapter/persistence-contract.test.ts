import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionValue } from "@/lib/admin-auth";
import {
  createMemoryApprovalStore,
  issueTrustedOwnerApproval,
  revokeTrustedOwnerApproval,
} from "../supervisor/trusted-approval";
import { createSupervisorTask, transitionTask } from "../supervisor/task";
import type {
  ApprovalAuthorityPersistencePort,
  ApprovalConnectionLifecycle,
  ApprovalExecutorPersistencePort,
} from "./approval-persistence-port";
import { createPostgresApprovalStore } from "./postgres-approval-store";
import { trustedTargetFromIdentity } from "./trusted-connection-target";

const now = "2026-10-21T20:00:00.000Z";

const identity = {
  projectId: "aged-brook-70202332",
  branchId: "br-contract-disposable-01",
  databaseName: "neondb",
  host: "ep-contract-disposable-01",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
};

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

function wiredStore(memory = createMemoryApprovalStore()) {
  const calls: string[] = [];
  const authority: ApprovalAuthorityPersistencePort = {
    readTask: (id) => {
      calls.push("authority:readTask");
      return memory.readTask(id);
    },
    saveTask: (task) => {
      calls.push("authority:saveTask");
      return memory.saveTask(task);
    },
    commitApproval: (attempt) => {
      calls.push("authority:commitApproval");
      return memory.commitApproval(attempt);
    },
    readApproval: (id) => {
      calls.push("authority:readApproval");
      return memory.readApproval(id);
    },
    revokeApproval: (id, revokedAt) => {
      calls.push("authority:revokeApproval");
      return memory.revokeApproval(id, revokedAt);
    },
  };
  const executor: ApprovalExecutorPersistencePort = {
    readTask: (id) => {
      calls.push("executor:readTask");
      return memory.readTask(id);
    },
    readApproval: (id) => {
      calls.push("executor:readApproval");
      return memory.readApproval(id);
    },
    markTaskRunning: (attempt) => {
      calls.push("executor:markTaskRunning");
      return memory.markTaskRunning(attempt);
    },
  };
  const lifecycle: ApprovalConnectionLifecycle = {
    beforeAuthorityConnect() {
      calls.push("lifecycle:authorityConnect");
    },
    beforeExecutorConnect() {
      calls.push("lifecycle:executorConnect");
    },
    async observeAuthoritySession() {
      return observation(identity.authorityRole);
    },
    async observeExecutorSession() {
      return observation(identity.executorRole);
    },
  };
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget: trustedTargetFromIdentity(identity),
    attemptedAuthorityTarget: trustedTargetFromIdentity(identity),
    attemptedExecutorTarget: trustedTargetFromIdentity(identity),
    lifecycle,
    authority,
    executor,
  });
  return { store, memory, calls };
}

test("persistence contract: issuance, revocation, and idempotent replay", async () => {
  const { store, memory } = wiredStore();
  const task = transitionTask(
    createSupervisorTask({
      id: "task-contract",
      goalId: "goal-1",
      specialistId: "engineering",
      description: "Contract task",
      requestedOperations: ["merge_main"],
      idempotencyKey: "idem-task",
      planVersion: 2,
      now,
    }),
    "awaiting_approval",
    now,
  );
  await store.saveTask(task);
  const previousOwners = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari";
  process.env.ADMIN_SESSION_SECRET = previousSecret || "cam-contract-test-secret";
  const issued = await issueTrustedOwnerApproval({
    sessionToken: createAdminSessionValue("omari"),
    taskId: task.id,
    operation: "merge_main",
    environment: "local",
    idempotencyKey: "idem-issue",
    store,
    now,
  });
  const replay = await issueTrustedOwnerApproval({
    sessionToken: createAdminSessionValue("omari"),
    taskId: task.id,
    operation: "merge_main",
    environment: "local",
    idempotencyKey: "idem-issue",
    store,
    now,
  });
  assert.equal(replay.record.id, issued.record.id);
  await revokeTrustedOwnerApproval({
    sessionToken: createAdminSessionValue("omari"),
    approvalId: issued.record.id,
    store,
    now,
  });
  await assert.rejects(
    issueTrustedOwnerApproval({
      sessionToken: createAdminSessionValue("omari"),
      taskId: task.id,
      operation: "merge_main",
      environment: "local",
      idempotencyKey: "idem-issue",
      store,
      now,
    }),
    /revoked/,
  );
  assert.equal((await memory.readTask(task.id))?.state, "approved");
  if (previousOwners === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previousOwners;
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
});

test("persistence contract: executor cannot call authority commit path", async () => {
  const { store, calls } = wiredStore();
  const task = transitionTask(
    createSupervisorTask({
      id: "task-exec",
      goalId: "goal-1",
      specialistId: "engineering",
      description: "x",
      requestedOperations: ["merge_main"],
      idempotencyKey: "idem-exec",
      planVersion: 1,
      now,
    }),
    "awaiting_approval",
    now,
  );
  await store.saveTask(task);
  calls.length = 0;
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
  assert.ok(calls.some((entry) => entry.startsWith("executor:")));
  assert.equal(calls.some((entry) => entry === "authority:commitApproval"), false);
});

test("persistence contract: ambiguous commit does not publish when memory fails before publish", async () => {
  const memory = createMemoryApprovalStore();
  memory.failBeforePublish();
  const { store } = wiredStore(memory);
  const task = transitionTask(
    createSupervisorTask({
      id: "task-amb",
      goalId: "goal-1",
      specialistId: "engineering",
      description: "x",
      requestedOperations: ["merge_main"],
      idempotencyKey: "idem-amb",
      planVersion: 1,
      now,
    }),
    "awaiting_approval",
    now,
  );
  await store.saveTask(task);
  const previousOwners = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari";
  process.env.ADMIN_SESSION_SECRET = previousSecret || "cam-contract-test-secret";
  await assert.rejects(
    issueTrustedOwnerApproval({
      sessionToken: createAdminSessionValue("omari"),
      taskId: task.id,
      operation: "merge_main",
      environment: "local",
      idempotencyKey: "idem-amb-issue",
      store,
      now,
    }),
    /did not commit/,
  );
  assert.equal(await store.readApproval("approval-idem-amb-issue"), null);
  if (previousOwners === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previousOwners;
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
});
