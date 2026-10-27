import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeLiveOrchestrationDatabaseUrl,
  diagnoseOrchestrationEnv,
  endpointMarkerInDatabaseUrl,
  orchestrationEnvIsStagingReady,
} from "./orchestration-env-safeguards";

test("endpoint deny list alone does not prove staging identity", () => {
  const arbitraryHost =
    "postgresql://u:p@ep-arbitrary-new-staging.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
  assert.equal(endpointMarkerInDatabaseUrl(arbitraryHost), null);
  const envCheck = diagnoseOrchestrationEnv({
    poolEnabled: true,
    liveDatabaseUrl: arbitraryHost,
  });
  assert.equal(envCheck.some((row) => row.code === "denied_live_endpoint"), false);
});

test("endpointMarkerInDatabaseUrl detects denied twilight and disposable hosts", () => {
  assert.equal(
    endpointMarkerInDatabaseUrl(
      "postgresql://u:p@ep-gentle-dawn-au6vxirn-pooler.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ),
    "ep-gentle-dawn-au6vxirn",
  );
  assert.equal(
    endpointMarkerInDatabaseUrl(
      "postgresql://u:p@ep-nameless-dream-b7hvelbo-pooler.c-13.us-east-1.aws.neon.tech/neondb",
    ),
    "ep-nameless-dream-b7hvelbo",
  );
  assert.equal(
    endpointMarkerInDatabaseUrl("postgresql://u:p@ep-staging-example.c-13.us-east-1.aws.neon.tech/neondb"),
    null,
  );
});

test("diagnoseOrchestrationEnv rejects pool without live url and disposable equals live", () => {
  const missing = diagnoseOrchestrationEnv({ poolEnabled: true });
  assert.equal(missing.some((row) => row.code === "missing_live_database_url"), true);
  const same = diagnoseOrchestrationEnv({
    poolEnabled: true,
    liveDatabaseUrl: "postgresql://a",
    disposableDatabaseUrl: "postgresql://a",
  });
  assert.equal(same.some((row) => row.code === "disposable_equals_live"), true);
});

test("assertSafeLiveOrchestrationDatabaseUrl throws for denied endpoints", () => {
  assert.throws(
    () =>
      assertSafeLiveOrchestrationDatabaseUrl(
        "postgresql://u:p@ep-muddy-math-auxmesyz.c-10.us-east-1.aws.neon.tech/neondb",
      ),
    /denied endpoint/,
  );
});

test("orchestrationEnvIsStagingReady requires durable flags and safe live url", () => {
  const env = {
    CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED: "true",
    CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED: "true",
    CAM_ORCHESTRATION_POOL_ENABLED: "true",
    CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID: "br-staging-queue-5a2-20261026",
    CAM_ORCHESTRATION_DATABASE_URL:
      "postgresql://u:p@ep-staging-cam-example.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require",
  };
  assert.equal(orchestrationEnvIsStagingReady(env), true);
  assert.equal(
    orchestrationEnvIsStagingReady({
      ...env,
      CAM_ORCHESTRATION_DATABASE_URL:
        "postgresql://u:p@ep-nameless-dream-b7hvelbo-pooler.c-13.us-east-1.aws.neon.tech/neondb",
    }),
    false,
  );
});
