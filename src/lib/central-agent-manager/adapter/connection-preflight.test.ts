import assert from "node:assert/strict";
import test from "node:test";
import { verifyBeforeConnect, verifyExecutorSession } from "./connection-preflight";
import { trustedTargetFromIdentity } from "./trusted-connection-target";

const identity = {
  projectId: "aged-brook-70202332",
  branchId: "br-verify-disposable-02",
  databaseName: "neondb",
  host: "ep-verify-disposable-02",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
};

const trusted = trustedTargetFromIdentity(identity);

test("verifyBeforeConnect rejects missing or contradictory target fields", () => {
  assert.throws(
    () =>
      verifyBeforeConnect({
        identity,
        trustedTarget: trusted,
        attemptedTarget: { ...trusted, branchId: "br-other-disposable" },
      }),
    /rejected/,
  );
});

test("verifyExecutorSession rejects wrong session role", () => {
  assert.throws(
    () =>
      verifyExecutorSession({
        identity,
        trustedTarget: trusted,
        attemptedTarget: trusted,
        observed: {
          projectId: identity.projectId,
          branchId: identity.branchId,
          databaseName: identity.databaseName,
          host: identity.host,
          sessionUser: identity.authorityRole,
          currentDatabase: identity.databaseName,
          neonBranchId: identity.branchId,
        },
      }),
    /rejected/,
  );
});
