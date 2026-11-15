import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  createStagingPlannerGuardedSql,
  MARKETING_STAGING_NEON_PROJECT_ID_ENV,
  PRODUCTION_NEON_PROJECT_ID,
  STAGING_PLANNER_DATABASE_GUARD_ERROR,
  STAGING_PLANNER_NEON_PROJECT_ALLOWLIST,
  STAGING_PLANNER_PREVIEW_GUARD_REF,
  stagingPlannerDbIdentityMatches,
  stagingPlannerPreviewDatabaseGuardDecision,
  StagingPlannerDatabaseGuardError,
} from "./staging-planner-db-guard";

const STAGING_PROJECT = STAGING_PLANNER_NEON_PROJECT_ALLOWLIST[0];

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: process.env[MARKETING_STAGING_NEON_PROJECT_ID_ENV],
};

afterEach(() => {
  for (const key of Object.keys(ORIGINAL_ENV) as (keyof typeof ORIGINAL_ENV)[]) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stagingGoodRow(overrides: Record<string, unknown> = {}) {
  return {
    current_user: "neondb_owner",
    current_database: "neondb",
    neon_branch_id: "br-test",
    neon_project_id: STAGING_PROJECT,
    marketing_content_insert_allowed: true,
    ...overrides,
  };
}

test("stagingPlannerPreviewDatabaseGuardDecision: skip unrelated preview branches", () => {
  assert.equal(
    stagingPlannerPreviewDatabaseGuardDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/other",
    }),
    "skip",
  );
  assert.equal(stagingPlannerPreviewDatabaseGuardDecision({ VERCEL_ENV: "production" }), "skip");
});

test("stagingPlannerPreviewDatabaseGuardDecision: guard integration preview with allowlisted project env", () => {
  assert.equal(
    stagingPlannerPreviewDatabaseGuardDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: STAGING_PLANNER_PREVIEW_GUARD_REF,
      [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: STAGING_PROJECT,
    }),
    "guard",
  );
});

test("stagingPlannerPreviewDatabaseGuardDecision: reject missing or invalid staging project env", () => {
  assert.equal(
    stagingPlannerPreviewDatabaseGuardDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: STAGING_PLANNER_PREVIEW_GUARD_REF,
    }),
    "reject",
  );
  assert.equal(
    stagingPlannerPreviewDatabaseGuardDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: STAGING_PLANNER_PREVIEW_GUARD_REF,
      [MARKETING_STAGING_NEON_PROJECT_ID_ENV]: "wrong-project-id",
    }),
    "reject",
  );
});

test("stagingPlannerDbIdentityMatches: allows writable staging verification project", () => {
  assert.equal(
    stagingPlannerDbIdentityMatches([stagingGoodRow()], STAGING_PROJECT),
    true,
  );
});

test("stagingPlannerDbIdentityMatches: rejects production project id", () => {
  assert.equal(
    stagingPlannerDbIdentityMatches(
      [
        stagingGoodRow({
          neon_project_id: PRODUCTION_NEON_PROJECT_ID,
          marketing_content_insert_allowed: false,
        }),
      ],
      STAGING_PROJECT,
    ),
    false,
  );
  assert.equal(
    stagingPlannerDbIdentityMatches(
      [stagingGoodRow({ neon_project_id: PRODUCTION_NEON_PROJECT_ID })],
      STAGING_PROJECT,
    ),
    false,
  );
});

test("stagingPlannerDbIdentityMatches: rejects read-only staging role", () => {
  assert.equal(
    stagingPlannerDbIdentityMatches(
      [stagingGoodRow({ marketing_content_insert_allowed: false })],
      STAGING_PROJECT,
    ),
    false,
  );
});

test("stagingPlannerDbIdentityMatches: rejects mismatched expected project", () => {
  assert.equal(
    stagingPlannerDbIdentityMatches([stagingGoodRow()], "other-allowed-not-used"),
    false,
  );
});

test("createStagingPlannerGuardedSql: probes before caller query", async () => {
  let probeCount = 0;
  const client = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    return Promise.resolve(text.includes("neon.project_id") ? [stagingGoodRow()] : [{ ok: true }]);
  }) as unknown as NeonQueryFunction<false, false>;
  client.query = ((query: string) => {
    if (query.includes("neon.project_id")) {
      probeCount += 1;
      return Promise.resolve([stagingGoodRow()]);
    }
    return Promise.resolve([{ ok: true }]);
  }) as unknown as NeonQueryFunction<false, false>["query"];

  const guarded = createStagingPlannerGuardedSql(client, STAGING_PROJECT, { timeoutMs: 2_000 });
  await guarded.query("SELECT 1");
  assert.equal(probeCount, 1);
  await guarded.query("SELECT 2");
  assert.equal(probeCount, 1);
});

test("createStagingPlannerGuardedSql: mismatch rejects before caller query", async () => {
  const client = (() =>
    Promise.resolve([
      stagingGoodRow({
        neon_project_id: PRODUCTION_NEON_PROJECT_ID,
        marketing_content_insert_allowed: false,
      }),
    ])) as unknown as NeonQueryFunction<false, false>;
  client.query = (() =>
    Promise.resolve([
      stagingGoodRow({
        neon_project_id: PRODUCTION_NEON_PROJECT_ID,
      }),
    ])) as unknown as NeonQueryFunction<false, false>["query"];

  const guarded = createStagingPlannerGuardedSql(client, STAGING_PROJECT, { timeoutMs: 2_000 });
  await assert.rejects(
    async () => guarded.query("SELECT 1"),
    (error: unknown) => {
      assert.ok(error instanceof StagingPlannerDatabaseGuardError);
      assert.equal(error.category, "mismatch");
      assert.equal(error.message, STAGING_PLANNER_DATABASE_GUARD_ERROR);
      return true;
    },
  );
});

test("resolve route: production order-notifications guard unchanged", async () => {
  const { resolveMarketingDatabaseGuardRoute } = await import("./marketing-database-guard");
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/order-notifications",
    }),
    "production-ro",
  );
});