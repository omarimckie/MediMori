import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalDatabaseIdentity,
  assertApprovalExecutorSession,
  assertApprovalIssuancePermitted,
  assertApprovalIssuerSession,
  type ApprovalSessionObservation,
} from "./approval-database-identity";

const issuer: ApprovalSessionObservation = {
  projectId: approvalDatabaseIdentity.projectId,
  branchId: approvalDatabaseIdentity.branchId,
  databaseName: approvalDatabaseIdentity.databaseName,
  host: approvalDatabaseIdentity.host,
  sessionUser: approvalDatabaseIdentity.authorityRole,
  currentDatabase: approvalDatabaseIdentity.databaseName,
  neonBranchId: approvalDatabaseIdentity.branchId,
};

test("issuer and executor sessions are distinct same-session checks", () => {
  assert.doesNotThrow(() => assertApprovalIssuerSession(issuer));
  assert.doesNotThrow(() => assertApprovalIssuancePermitted(issuer));
  assert.doesNotThrow(() => assertApprovalIssuerSession({
    ...issuer,
    host: "ep-bold-bird-b73ys3uy-pooler.us-east-1.aws.neon.tech",
  }));
  assert.throws(
    () => assertApprovalIssuerSession({ ...issuer, sessionUser: approvalDatabaseIdentity.executorRole }),
    /rejected/,
  );
  assert.doesNotThrow(() => assertApprovalExecutorSession({
    ...issuer,
    sessionUser: approvalDatabaseIdentity.executorRole,
  }));
  assert.throws(
    () => assertApprovalExecutorSession(issuer),
    /rejected/,
  );
});

test("session identity rejects production, owner roles, and a mismatched database observation", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://neondb_owner:redacted@ep-muddy-math-auxmesyz.neon.tech/neondb";
  try {
    for (const observed of [
      { ...issuer, host: "ep-muddy-math-auxmesyz" },
      { ...issuer, host: "ep-muddy-math-auxmesyz-pooler.neon.tech" },
      { ...issuer, host: "ep-gentle-dawn-au6vxirn" },
      { ...issuer, host: "ep-bold-bird-b73ys3uy.attacker.test.not-a-neon-host" },
      { ...issuer, projectId: "solitary-leaf-77946642" },
      { ...issuer, branchId: "br-quiet-fire-ausvjkg8" },
      { ...issuer, neonBranchId: "br-little-art-au7ke21s" },
      { ...issuer, currentDatabase: "postgres" },
      { ...issuer, databaseName: "postgres" },
      { ...issuer, sessionUser: "neondb_owner" },
      { ...issuer, sessionUser: "central_agent_manager_approval_owner" },
      { ...issuer, sessionUser: "central_agent_manager_approval" },
      { ...issuer, host: "" },
      { ...issuer, neonBranchId: approvalDatabaseIdentity.branchId, currentDatabase: "neondb", sessionUser: "central_agent_manager_approval_authority", projectId: "aged-brook-70202333" },
    ]) {
      assert.throws(() => assertApprovalIssuancePermitted(observed), /rejected/);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
