import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildPreviewRuntimeDeploymentIdentity,
  parsePreviewRuntimeDbIdentityRows,
  previewRuntimeDbIdentityResponse,
  previewRuntimeDbIdentitySql,
} from "./preview-runtime-db-identity";

const probeRow = {
  current_user: "tf_preview_marketing_ro",
  current_database: "neondb",
  neon_branch_id: "br-example",
  neon_project_id: "small-frost-27394379",
  marketing_content_insert_allowed: false,
};

test("preview runtime identity SQL includes neon project id", () => {
  const sql = previewRuntimeDbIdentitySql();
  assert.match(sql, /neon\.project_id/);
  assert.doesNotMatch(sql, /\b(insert into|update\s|delete from)\b/i);
});

test("route is authenticated GET only", () => {
  const source = readFileSync(
    new URL("../../app/api/admin/marketing/preview-runtime-db-identity/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /POST|PATCH|PUT|DELETE/);
  assert.match(source, /previewRuntimeDbIdentityResponse/);
  assert.doesNotMatch(source, /DATABASE_URL|password|BLOB_READ_WRITE_TOKEN/);
});

test("parse preview runtime identity returns neon project id", () => {
  const parsed = parsePreviewRuntimeDbIdentityRows([probeRow]);
  assert.equal(parsed.neon_project_id, "small-frost-27394379");
  assert.equal(parsed.current_database, "neondb");
  assert.equal(parsed.marketing_content_insert_allowed, false);
});

test("deployment identity defaults preview readonly when unset", () => {
  const identity = buildPreviewRuntimeDeploymentIdentity({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feat/example",
  });
  assert.equal(identity.preview_readonly, true);
  assert.equal(identity.marketing_preview_readonly_configured, false);
  assert.equal(identity.database_guard_route, "preview-fail-closed");
});

test("preview runtime identity disabled outside preview", async () => {
  const response = await previewRuntimeDbIdentityResponse({
    isAuthenticated: async () => true,
    isPreviewRuntime: () => false,
    queryIdentity: async () => {
      throw new Error("should not query");
    },
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(body, { enabled: false });
});

test("authorized preview runtime identity returns non-secret fields", async () => {
  const response = await previewRuntimeDbIdentityResponse({
    isAuthenticated: async () => true,
    isPreviewRuntime: () => true,
    queryIdentity: async () => ({
      ...parsePreviewRuntimeDbIdentityRows([probeRow]),
      ...buildPreviewRuntimeDeploymentIdentity({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/example",
        MARKETING_PREVIEW_READONLY: "true",
      }),
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.neon_project_id, "small-frost-27394379");
  assert.equal(body.preview_readonly, true);
  assert.equal(body.marketing_preview_readonly_configured, true);
  assert.equal(body.vercel_env, "preview");
  assert.equal(body.vercel_git_commit_ref, "feat/example");
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /postgres:\/\/|password|DATABASE_URL/i);
});