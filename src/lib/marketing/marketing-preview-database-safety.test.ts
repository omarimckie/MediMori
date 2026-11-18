import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMarketingDatabaseGuardRoute } from "./marketing-database-guard";
import {
  isMarketingPreviewReadonly,
  isMarketingPreviewReadonlyExplicitlyDisabled,
} from "./preview-readonly";

test("production marketing database guard route is unchanged", () => {
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "production",
      DATABASE_URL: "postgres://example",
    }),
    "skip",
  );
});

test("missing preview readonly config defaults to protected preview", () => {
  assert.equal(
    isMarketingPreviewReadonly({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/x" }),
    true,
  );
});

test("explicit preview readonly disable is honored for authorized write windows", () => {
  assert.equal(
    isMarketingPreviewReadonlyExplicitlyDisabled({
      VERCEL_ENV: "preview",
      MARKETING_PREVIEW_READONLY: "false",
    }),
    true,
  );
  assert.equal(
    isMarketingPreviewReadonly({
      VERCEL_ENV: "preview",
      MARKETING_PREVIEW_READONLY: "false",
    }),
    false,
  );
});

test("misconfigured integration staging preview still rejects without project id", () => {
  assert.equal(
    resolveMarketingDatabaseGuardRoute({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "integration/twilight-feather-add-to-planner",
    }),
    "reject",
  );
});