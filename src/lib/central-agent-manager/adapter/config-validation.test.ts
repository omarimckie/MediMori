import assert from "node:assert/strict";
import test from "node:test";
import { approvalDatabaseIdentity } from "../approval-database-identity";
import { validateAdapterConfig } from "./config-validation";
import { createPostgresApprovalStore } from "./postgres-approval-store";
import { trustedTargetFromIdentity } from "./trusted-connection-target";

test("adapter config rejects production and shared staging branch ids", () => {
  assert.equal(validateAdapterConfig({
    ...approvalDatabaseIdentity,
    branchId: "br-nameless-mode-b7hkls9l",
  }).ok, false);
  assert.equal(validateAdapterConfig({
    ...approvalDatabaseIdentity,
    host: "ep-muddy-math-auxmesyz",
  }).ok, false);
});

test("createPostgresApprovalStore fails closed on denied staging identity", () => {
  assert.throws(() =>
    createPostgresApprovalStore({
      identity: approvalDatabaseIdentity,
      trustedTarget: trustedTargetFromIdentity(approvalDatabaseIdentity),
      attemptedAuthorityTarget: trustedTargetFromIdentity(approvalDatabaseIdentity),
      attemptedExecutorTarget: trustedTargetFromIdentity(approvalDatabaseIdentity),
      lifecycle: {
        beforeAuthorityConnect() {},
        beforeExecutorConnect() {},
        async observeAuthoritySession() {
          throw new Error("should not connect");
        },
        async observeExecutorSession() {
          throw new Error("should not connect");
        },
      },
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
    }),
  );
});
