import assert from "node:assert/strict";
import test from "node:test";
import { approvalDatabaseIdentity } from "../approval-database-identity";
import {
  assertDisposableDatabaseIdentity,
  resolveDisposableExecutorEnabled,
  runDisposableCaseOffline,
  runDisposableExecutorOfflineBatch,
} from "./approval-disposable-postgres-executor";
import { disposableVerificationManifest } from "../verification/disposable-verification-manifest";

test("executor disabled without explicit flag", () => {
  assert.equal(resolveDisposableExecutorEnabled({}), false);
  assert.equal(resolveDisposableExecutorEnabled({ CAM_APPROVAL_DISPOSABLE_EXECUTE: "true" }), true);
});

test("identity rejects orchestration staging branch", () => {
  assert.throws(() =>
    assertDisposableDatabaseIdentity({
      projectId: approvalDatabaseIdentity.projectId,
      branchId: "br-wispy-river-b7zzwpij",
      databaseName: approvalDatabaseIdentity.databaseName,
      host: approvalDatabaseIdentity.host,
      sessionUser: approvalDatabaseIdentity.authorityRole,
      currentDatabase: approvalDatabaseIdentity.databaseName,
      neonBranchId: "br-wispy-river-b7zzwpij",
    }),
  );
});

test("offline batch runs manifest cases against mock port", async () => {
  const case11 = disposableVerificationManifest.find((row) => row.id === "1.1");
  assert.ok(case11);
  const port = {
    async query() {
      return { ok: true, rows: [{ digest_hex: "abc" }] };
    },
  };
  const single = await runDisposableCaseOffline(case11, port);
  assert.equal(single.ok, true);
  const batch = await runDisposableExecutorOfflineBatch({ port, caseIds: ["1.1", "1.2"] });
  assert.equal(batch.ok, true);
  assert.equal(batch.executed.length, 2);
});
