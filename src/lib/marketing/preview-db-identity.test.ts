import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  parsePreviewDbIdentityRows,
  previewDbIdentityResponse,
  previewDbIdentitySql,
} from "./preview-db-identity";

const identityRow = {
  current_user: "tf_preview_marketing_ro",
  current_database: "neondb",
  marketing_content_insert_allowed: false,
};

test("preview database identity SQL is a single read of role, database, and INSERT privilege", () => {
  const sql = previewDbIdentitySql();
  assert.match(sql, /^SELECT/);
  assert.match(sql, /current_user/);
  assert.match(sql, /current_database\(\)/);
  assert.match(
    sql,
    /has_table_privilege\(current_user, 'public\.marketing_content', 'INSERT'\)/,
  );
  assert.doesNotMatch(sql, /\b(insert into|update\s|delete from|drop\s|grant\s|alter\s)\b/i);
});

test("preview database identity route is an authenticated GET", () => {
  const source = readFileSync(
    "src/app/api/admin/marketing/preview-db-identity/route.ts",
    "utf8",
  );
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE|HEAD)/);
  assert.match(source, /dynamic = "force-dynamic"/);
  assert.match(source, /isAdminAuthenticated/);
  assert.match(source, /isMarketingPreviewReadonly/);
  assert.match(source, /queryPreviewDatabaseIdentity/);
  assert.doesNotMatch(source, /DATABASE_URL|password|BLOB_READ_WRITE_TOKEN/);
});

test("unauthenticated preview identity requests do not query the database", async () => {
  let queried = false;
  const response = await previewDbIdentityResponse({
    isAuthenticated: async () => false,
    isPreviewReadonly: () => true,
    queryIdentity: async () => {
      queried = true;
      return [identityRow];
    },
  });
  assert.equal(queried, false);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { error: "Unauthorized." });
  assert.equal("current_user" in body, false);
});

test("authentication failures fail closed", async () => {
  let queried = false;
  const response = await previewDbIdentityResponse({
    isAuthenticated: async () => {
      throw new Error("postgres://tf_preview_marketing_ro:secret@db.example/neondb");
    },
    isPreviewReadonly: () => true,
    queryIdentity: async () => {
      queried = true;
      return [identityRow];
    },
  });
  assert.equal(queried, false);
  assert.equal(response.status, 401);
  const raw = await response.text();
  assert.doesNotMatch(raw, /postgres:\/\//);
  assert.doesNotMatch(raw, /secret/);
});

test("authorized preview identity returns only role, database, and INSERT permission", async () => {
  const response = await previewDbIdentityResponse({
    isAuthenticated: async () => true,
    isPreviewReadonly: () => true,
    queryIdentity: async () => [identityRow],
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), [
    "current_database",
    "current_user",
    "marketing_content_insert_allowed",
  ]);
  assert.deepEqual(body, identityRow);
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /postgres:\/\/|password|token|DATABASE_URL|sslmode/i);
});

test("identity diagnostic is disabled outside preview read-only mode", async () => {
  let queried = false;
  const response = await previewDbIdentityResponse({
    isAuthenticated: async () => true,
    isPreviewReadonly: () => false,
    queryIdentity: async () => {
      queried = true;
      return [identityRow];
    },
  });
  assert.equal(queried, false);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { enabled: false });
  assert.equal("current_user" in body, false);
  assert.equal("current_database" in body, false);
});

test("database errors fail closed without sensitive details", async () => {
  const response = await previewDbIdentityResponse({
    isAuthenticated: async () => true,
    isPreviewReadonly: () => true,
    queryIdentity: async () => {
      throw new Error("connect failed postgres://role:s3cret-token@ep-example/neondb");
    },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const raw = await response.text();
  assert.match(raw, /Database identity check failed/);
  assert.doesNotMatch(raw, /postgres:\/\//);
  assert.doesNotMatch(raw, /s3cret/);
  assert.doesNotMatch(raw, /current_user/);
});

test("unexpected identity rows fail closed", () => {
  assert.throws(() => parsePreviewDbIdentityRows([]));
  assert.throws(() =>
    parsePreviewDbIdentityRows([
      {
        ...identityRow,
        marketing_content_insert_allowed: "false",
      },
    ]),
  );
  assert.throws(() =>
    parsePreviewDbIdentityRows([
      {
        ...identityRow,
        database_url: "postgres://role:secret@db/neondb",
      },
    ]),
  );
  assert.throws(() =>
    parsePreviewDbIdentityRows([
      {
        ...identityRow,
        current_user: "postgres://role:secret@db/neondb",
      },
    ]),
  );
});
