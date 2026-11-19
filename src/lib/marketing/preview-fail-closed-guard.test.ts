import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPreviewFailClosedGuardedSql,
  PreviewFailClosedDatabaseGuardError,
  previewFailClosedIdentityMatches,
} from "./preview-fail-closed-guard";
import { PRODUCTION_NEON_PROJECT_ID } from "./staging-planner-db-guard";
import { PREVIEW_DB_EXPECTED_PROJECT, previewDbIdentityMatches } from "./preview-db-guard";
import { resolveMarketingDatabaseGuardRoute } from "./marketing-database-guard";

const STAGING_PROJECT = "small-frost-27394379";

test("preview fail-closed rejects unrestricted Production neon project id", () => {
  assert.equal(
    previewFailClosedIdentityMatches([
      {
        neon_project_id: PRODUCTION_NEON_PROJECT_ID,
        current_user: "neondb_owner",
        current_database: "neondb",
        marketing_content_insert_allowed: true,
      },
    ]),
    false,
  );
});

test("preview fail-closed allows staging neon project id", () => {
  assert.equal(
    previewFailClosedIdentityMatches([
      {
        neon_project_id: STAGING_PROJECT,
        current_user: "neondb_owner",
        current_database: "neondb",
        marketing_content_insert_allowed: true,
      },
    ]),
    true,
  );
});

test("preview fail-closed rejects unknown non-production neon project ids", () => {
  assert.equal(
    previewFailClosedIdentityMatches([
      {
        neon_project_id: "aged-brook-70202332",
        current_user: "neondb_owner",
        current_database: "neondb",
        marketing_content_insert_allowed: false,
      },
    ]),
    false,
  );
});

test("order-notifications production read-only exception uses production-ro route", () => {
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/order-notifications",
    }),
    "production-ro",
  );
  assert.equal(
    previewDbIdentityMatches([
      {
        current_user: "tf_preview_marketing_ro",
        current_database: "neondb",
        neon_branch_id: "br-quiet-fire-ausvjkg8",
        neon_project_id: PREVIEW_DB_EXPECTED_PROJECT,
        marketing_content_insert_allowed: false,
      },
    ]),
    true,
  );
});

test("integration staging preview uses staging-writable route", () => {
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "integration/twilight-feather-add-to-planner",
      MARKETING_STAGING_NEON_PROJECT_ID: STAGING_PROJECT,
    }),
    "staging-writable",
  );
});

test("generic feature preview uses preview-fail-closed route", () => {
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feat/planning-queue-image-previews",
    }),
    "preview-fail-closed",
  );
});

test("production runtime skips preview fail-closed", () => {
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    }),
    "skip",
  );
});

test("guarded sql blocks Production neon probe on preview", async () => {
  const client = {
    async query(text: string) {
      if (text.includes("neon.project_id")) {
        return [
          {
            neon_project_id: PRODUCTION_NEON_PROJECT_ID,
            current_user: "neondb_owner",
            current_database: "neondb",
            marketing_content_insert_allowed: true,
          },
        ];
      }
      return [{ ok: 1 }];
    },
  };
  const guarded = createPreviewFailClosedGuardedSql(client as never, { timeoutMs: 2_000 });
  await assert.rejects(
    () => guarded.query("SELECT 1"),
    (error: unknown) => {
      assert.ok(error instanceof PreviewFailClosedDatabaseGuardError);
      return true;
    },
  );
});