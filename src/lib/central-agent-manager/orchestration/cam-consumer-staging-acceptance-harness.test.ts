import assert from "node:assert/strict";
import test from "node:test";
import {
  CAM_STAGING_NEON_BRANCH_ID,
  diagnoseStagingDatabaseUrl,
  redactHarnessEvidence,
  resolveHarnessMode,
  runStagingAcceptancePreflight,
  validateStagingTestJobId,
} from "./cam-consumer-staging-acceptance-harness";
import { CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID } from "./orchestration-staging-identity";

const BASE_ENV = {
  CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID: CAM_ORCHESTRATION_STAGING_NEON_PROJECT_ID,
  CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID: CAM_STAGING_NEON_BRANCH_ID,
  CAM_ORCHESTRATION_POOL_ENABLED: "false",
};

test("resolveHarnessMode defaults to dry_run", () => {
  assert.equal(resolveHarnessMode({}, []), "dry_run");
  assert.equal(resolveHarnessMode({}, ["--dry-run"]), "dry_run");
  assert.equal(resolveHarnessMode({ CAM_CONSUMER_STAGING_EXECUTE_WRITES: "true" }, ["--execute"]), "execute");
});

test("validateStagingTestJobId rejects protected and malformed ids", () => {
  assert.equal(validateStagingTestJobId(undefined)?.code, "missing_test_job_id");
  assert.equal(validateStagingTestJobId("job-staging-5a2b-20261026-om")?.code, "protected_test_job_id");
  assert.equal(validateStagingTestJobId("job-staging-5b-consumer-20261026-a3")?.code, "protected_test_job_id");
  assert.equal(validateStagingTestJobId("job-staging-5b-consumer-bad")?.code, "invalid_test_job_id");
  assert.equal(validateStagingTestJobId("job-staging-5b-consumer-20261026-x9"), null);
});

test("diagnoseStagingDatabaseUrl rejects denied disposable endpoint host", () => {
  const rows = diagnoseStagingDatabaseUrl(
    "postgresql://u:p@ep-nameless-dream-b7hvelbo-pooler.example/neondb?sslmode=require",
  );
  assert.equal(rows.some((row) => row.code === "denied_database_endpoint"), true);
});

test("runStagingAcceptancePreflight dry_run passes without execute secrets", () => {
  const lines = runStagingAcceptancePreflight({
    env: {
      ...BASE_ENV,
      CAM_CONSUMER_STAGING_TEST_JOB_ID: "job-staging-5b-consumer-20261026-x9",
      CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON: '[{"agentId":"agent-staging-5b","token":"token-staging-5b-acceptance-01"}]',
    },
    mode: "dry_run",
  });
  assert.equal(lines.some((row) => !row.ok), false);
  assert.equal(lines.some((row) => row.code === "dry_run_mode"), true);
});

test("runStagingAcceptancePreflight execute requires harness flag and agent id", () => {
  const lines = runStagingAcceptancePreflight({
    env: {
      ...BASE_ENV,
      CAM_CONSUMER_STAGING_TEST_JOB_ID: "job-staging-5b-consumer-20261026-x9",
      CAM_CONSUMER_STAGING_EXECUTE_WRITES: "true",
      CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED: "true",
      CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON: '[{"agentId":"agent-staging-5b","token":"token-staging-5b-acceptance-01"}]',
      CAM_ORCHESTRATION_DATABASE_URL:
        "postgresql://u:p@ep-bitter-flower-b7cz1fzc-pooler.example/neondb?sslmode=require",
    },
    mode: "execute",
  });
  assert.equal(lines.some((row) => row.code === "harness_disabled"), true);
  const enabled = runStagingAcceptancePreflight({
    env: {
      ...BASE_ENV,
      CAM_ORCHESTRATION_POOL_ENABLED: "true",
      CAM_CONSUMER_STAGING_HARNESS_ENABLED: "true",
      CAM_CONSUMER_STAGING_TEST_JOB_ID: "job-staging-5b-consumer-20261026-x9",
      CAM_CONSUMER_STAGING_AGENT_ID: "agent-staging-5b",
      CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED: "true",
      CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON: '[{"agentId":"agent-staging-5b","token":"token-staging-5b-acceptance-01"}]',
      CAM_ORCHESTRATION_DATABASE_URL:
        "postgresql://u:p@ep-bitter-flower-b7cz1fzc-pooler.example/neondb?sslmode=require",
      CURSOR_API_KEY: "",
    },
    mode: "execute",
  });
  const failed = enabled.filter((row) => !row.ok);
  assert.equal(failed.length, 0, failed.map((row) => row.code).join(","));
});

test("redactHarnessEvidence removes secrets from structured evidence", () => {
  const redacted = redactHarnessEvidence({
    phases: {
      login: { authorization: "Bearer secret-token-12345678", cookie: "tf_admin_session=abc" },
    },
  });
  assert.equal(redacted.phases.login.authorization, "Bearer [redacted]");
  assert.equal(redacted.phases.login.cookie, "[redacted]");
});
