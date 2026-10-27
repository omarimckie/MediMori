import assert from "node:assert/strict";
import test from "node:test";
import { createOrchestrationSqlPortFromEnv } from "./orchestration-connection-factory";

test("orchestration sql port factory rejects live pool without expected neon branch id", async () => {
  const previousUrl = process.env.CAM_ORCHESTRATION_DATABASE_URL;
  const previousPool = process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  const previousBranch = process.env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID;
  process.env.CAM_ORCHESTRATION_POOL_ENABLED = "true";
  process.env.CAM_ORCHESTRATION_DATABASE_URL =
    "postgres://user:pass@ep-staging-cam-example.c-13.us-east-1.aws.neon.tech/neondb";
  delete process.env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID;
  await assert.rejects(() => createOrchestrationSqlPortFromEnv(), /CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID/);
  if (previousUrl === undefined) delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  else process.env.CAM_ORCHESTRATION_DATABASE_URL = previousUrl;
  if (previousPool === undefined) delete process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  else process.env.CAM_ORCHESTRATION_POOL_ENABLED = previousPool;
  if (previousBranch === undefined) delete process.env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID;
  else process.env.CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID = previousBranch;
});

test("orchestration sql port factory rejects denied live endpoint when pool enabled", async () => {
  const previousUrl = process.env.CAM_ORCHESTRATION_DATABASE_URL;
  const previousPool = process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  process.env.CAM_ORCHESTRATION_POOL_ENABLED = "true";
  process.env.CAM_ORCHESTRATION_DATABASE_URL =
    "postgres://user:pass@ep-nameless-dream-b7hvelbo-pooler.c-13.us-east-1.aws.neon.tech/neondb";
  await assert.rejects(() => createOrchestrationSqlPortFromEnv(), /denied endpoint/);
  if (previousUrl === undefined) delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  else process.env.CAM_ORCHESTRATION_DATABASE_URL = previousUrl;
  if (previousPool === undefined) delete process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  else process.env.CAM_ORCHESTRATION_POOL_ENABLED = previousPool;
});

test("orchestration sql port factory returns null when pool flag is disabled", async () => {
  const previousUrl = process.env.CAM_ORCHESTRATION_DATABASE_URL;
  const previousPool = process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  process.env.CAM_ORCHESTRATION_DATABASE_URL = "postgres://example.invalid/orchestration";
  delete process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  assert.equal(await createOrchestrationSqlPortFromEnv(), null);
  if (previousUrl === undefined) delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  else process.env.CAM_ORCHESTRATION_DATABASE_URL = previousUrl;
  if (previousPool === undefined) delete process.env.CAM_ORCHESTRATION_POOL_ENABLED;
  else process.env.CAM_ORCHESTRATION_POOL_ENABLED = previousPool;
});
