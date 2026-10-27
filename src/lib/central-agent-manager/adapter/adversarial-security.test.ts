import assert from "node:assert/strict";
import test from "node:test";
import { unavailableApprovalStore } from "../supervisor/trusted-approval";
import { diagnoseExplicitAdapterConfig, resolveExplicitAdapterIdentity } from "./explicit-config";
import { createPostgresApprovalStore } from "./postgres-approval-store";
import { trustedTargetFromIdentity } from "./trusted-connection-target";
import type { ApprovalConnectionLifecycle } from "./approval-persistence-port";

const identity = {
  projectId: "aged-brook-70202332",
  branchId: "br-adversarial-01",
  databaseName: "neondb",
  host: "ep-adversarial-01",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
};

const trusted = trustedTargetFromIdentity(identity);

test("missing explicit configuration resolves to null without DATABASE_URL fallback", () => {
  const previous = {
    project: process.env.CAM_APPROVAL_PROJECT_ID,
    branch: process.env.CAM_APPROVAL_BRANCH_ID,
    database: process.env.CAM_APPROVAL_DATABASE_NAME,
    host: process.env.CAM_APPROVAL_ENDPOINT_ID,
    databaseUrl: process.env.DATABASE_URL,
  };
  delete process.env.CAM_APPROVAL_PROJECT_ID;
  delete process.env.CAM_APPROVAL_BRANCH_ID;
  delete process.env.CAM_APPROVAL_DATABASE_NAME;
  delete process.env.CAM_APPROVAL_ENDPOINT_ID;
  process.env.DATABASE_URL = "postgres://neondb_owner:secret@ep-muddy-math-auxmesyz.neon.tech/neondb";
  assert.equal(resolveExplicitAdapterIdentity(), null);
  assert.equal(diagnoseExplicitAdapterConfig().ok, false);
  if (previous.project === undefined) delete process.env.CAM_APPROVAL_PROJECT_ID;
  else process.env.CAM_APPROVAL_PROJECT_ID = previous.project;
  if (previous.branch === undefined) delete process.env.CAM_APPROVAL_BRANCH_ID;
  else process.env.CAM_APPROVAL_BRANCH_ID = previous.branch;
  if (previous.database === undefined) delete process.env.CAM_APPROVAL_DATABASE_NAME;
  else process.env.CAM_APPROVAL_DATABASE_NAME = previous.database;
  if (previous.host === undefined) delete process.env.CAM_APPROVAL_ENDPOINT_ID;
  else process.env.CAM_APPROVAL_ENDPOINT_ID = previous.host;
  if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.databaseUrl;
});

test("identity failure prevents privileged persistence on subsequent operations in same store", async () => {
  const lifecycle: ApprovalConnectionLifecycle = {
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
        neonBranchId: "br-spoofed-branch-id",
      };
    },
    async observeExecutorSession() {
      throw new Error("unreachable");
    },
  };
  let authorityWrites = 0;
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
  await assert.rejects(() => store.readTask("task-1"), /rejected/);
  assert.equal(authorityWrites, 0);
});

test("unavailable store cannot be accidentally substituted by postgres adapter defaults", async () => {
  await assert.rejects(() => unavailableApprovalStore.readTask("task-1"), /unavailable/);
});

test("mismatched endpoint metadata is rejected before persistence", async () => {
  let authorityReads = 0;
  const wrong = { ...trusted, host: "ep-wrong-endpoint" };
  const mismatched = createPostgresApprovalStore({
    identity,
    trustedTarget: trusted,
    attemptedAuthorityTarget: wrong,
    attemptedExecutorTarget: trusted,
    lifecycle: {
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
        throw new Error("unreachable");
      },
    },
    authority: {
      readTask: async () => {
        authorityReads += 1;
        return null;
      },
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
  await assert.rejects(() => mismatched.readTask("task-1"), /rejected/);
  assert.equal(authorityReads, 0);
});
