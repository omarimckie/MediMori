import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOrchestrationStagingSessionMatches,
  CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID,
  diagnoseOrchestrationStagingIdentityEnv,
  parseOrchestrationStagingSessionObservationRow,
  resolveOrchestrationStagingIdentityExpectation,
} from "./orchestration-staging-identity";

test("resolveOrchestrationStagingIdentityExpectation requires explicit branch id", () => {
  assert.equal(resolveOrchestrationStagingIdentityExpectation({}), null);
  const resolved = resolveOrchestrationStagingIdentityExpectation({
    CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID: "br-staging-queue-5a2-20261026",
  });
  assert.equal(resolved?.projectId, CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID);
  assert.equal(resolved?.branchId, "br-staging-queue-5a2-20261026");
});

test("diagnoseOrchestrationStagingIdentityEnv flags pool without expected branch", () => {
  const rows = diagnoseOrchestrationStagingIdentityEnv(
    {},
    { poolEnabled: true, liveDatabaseUrl: "postgresql://u:p@ep-example.neon.tech/neondb" },
  );
  assert.equal(rows.some((row) => row.code === "missing_expected_neon_branch_id"), true);
});

test("diagnoseOrchestrationStagingIdentityEnv rejects denied disposable branch expectation", () => {
  const rows = diagnoseOrchestrationStagingIdentityEnv({
    CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID: "br-withered-dream-b71r3mo0",
  });
  assert.equal(rows.some((row) => row.code === "denied_expected_neon_branch_id"), true);
});

test("assertOrchestrationStagingSessionMatches uses database-reported ids only", () => {
  const expected = {
    projectId: CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID,
    branchId: "br-staging-queue-5a2-20261026",
  };
  assert.throws(
    () =>
      assertOrchestrationStagingSessionMatches(
        {
          neonProjectId: "solitary-leaf-77946642",
          neonBranchId: expected.branchId,
          currentDatabase: "neondb",
        },
        expected,
      ),
    /denied Neon project/,
  );
  assert.throws(
    () =>
      assertOrchestrationStagingSessionMatches(
        {
          neonProjectId: expected.projectId,
          neonBranchId: "br-withered-dream-b71r3mo0",
          currentDatabase: "neondb",
        },
        expected,
      ),
    /denied Neon branch/,
  );
  assert.throws(
    () =>
      assertOrchestrationStagingSessionMatches(
        {
          neonProjectId: expected.projectId,
          neonBranchId: "br-other-branch",
          currentDatabase: "neondb",
        },
        expected,
      ),
    /neon.branch_id does not match/,
  );
  assertOrchestrationStagingSessionMatches(
    {
      neonProjectId: expected.projectId,
      neonBranchId: expected.branchId,
      currentDatabase: "neondb",
    },
    expected,
  );
});

test("parseOrchestrationStagingSessionObservationRow fails closed on empty probe", () => {
  assert.throws(() => parseOrchestrationStagingSessionObservationRow(undefined), /no rows/);
  assert.throws(
    () => parseOrchestrationStagingSessionObservationRow({ neon_project_id: "", neon_branch_id: "br-x" }),
    /neon.project_id/,
  );
});
