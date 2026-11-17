import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { resetSqlCacheForTests, setSqlFactoryForTests } from "../db";
import {
  isProductionDbIdentityEnvironment,
  parseProductionDbIdentityRows,
  productionDbIdentityResponse,
  productionDbIdentitySql,
  queryProductionDatabaseIdentity,
} from "./production-db-identity";

const identityRow = {
  neon_project_id: "solitary-leaf-77946642",
  current_database: "neondb",
};

test("production database identity SQL is read-only neon project probe", () => {
  const sql = productionDbIdentitySql();
  assert.match(sql, /^SELECT/);
  assert.match(sql, /current_setting\('neon\.project_id', true\)/);
  assert.match(sql, /current_database\(\)/);
  assert.doesNotMatch(sql, /\b(insert into|update\s|delete from|drop\s|grant\s|alter\s)\b/i);
  assert.doesNotMatch(sql, /current_user|hostname|DATABASE_URL/i);
});

test("production database identity route is an authenticated GET", () => {
  const source = readFileSync(
    "src/app/api/admin/marketing/production-db-identity/route.ts",
    "utf8",
  );
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE|HEAD)/);
  assert.match(source, /dynamic = "force-dynamic"/);
  assert.match(source, /isAdminAuthenticated/);
  assert.match(source, /isProductionDbIdentityEnvironment/);
  assert.match(source, /queryProductionDatabaseIdentity/);
  assert.doesNotMatch(source, /DATABASE_URL|password|BLOB_READ_WRITE_TOKEN|hostname/i);
});

test("isProductionDbIdentityEnvironment requires VERCEL_ENV production", () => {
  assert.equal(isProductionDbIdentityEnvironment({ VERCEL_ENV: "production" }), true);
  assert.equal(isProductionDbIdentityEnvironment({ VERCEL_ENV: "preview" }), false);
  assert.equal(isProductionDbIdentityEnvironment({ VERCEL_ENV: "development" }), false);
  assert.equal(isProductionDbIdentityEnvironment({}), false);
});

test("unauthenticated production identity requests do not query the database", async () => {
  let queried = false;
  const response = await productionDbIdentityResponse({
    isAuthenticated: async () => false,
    isProductionEnvironment: () => true,
    queryIdentity: async () => {
      queried = true;
      return identityRow;
    },
  });
  assert.equal(queried, false);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { error: "Unauthorized." });
  assert.equal("neon_project_id" in body, false);
});

test("authentication failures fail closed", async () => {
  let queried = false;
  const response = await productionDbIdentityResponse({
    isAuthenticated: async () => {
      throw new Error("postgres://role:secret@ep-example/neondb");
    },
    isProductionEnvironment: () => true,
    queryIdentity: async () => {
      queried = true;
      return identityRow;
    },
  });
  assert.equal(queried, false);
  assert.equal(response.status, 401);
  const raw = await response.text();
  assert.doesNotMatch(raw, /postgres:\/\//);
  assert.doesNotMatch(raw, /secret/);
});

test("identity diagnostic is disabled outside production", async () => {
  let queried = false;
  const response = await productionDbIdentityResponse({
    isAuthenticated: async () => true,
    isProductionEnvironment: () => false,
    queryIdentity: async () => {
      queried = true;
      return identityRow;
    },
  });
  assert.equal(queried, false);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { enabled: false });
  assert.equal("neon_project_id" in body, false);
});

test("authorized production identity returns only project id and database name", async () => {
  const response = await productionDbIdentityResponse({
    isAuthenticated: async () => true,
    isProductionEnvironment: () => true,
    queryIdentity: async () => identityRow,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["current_database", "neon_project_id"]);
  assert.deepEqual(body, identityRow);
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /postgres:\/\/|password|token|DATABASE_URL|sslmode|\.neon\.tech/i);
});

test("missing neon project id fails closed", async () => {
  assert.throws(() =>
    parseProductionDbIdentityRows([
      {
        neon_project_id: null,
        current_database: "neondb",
      },
    ]),
  );
  assert.throws(() =>
    parseProductionDbIdentityRows([
      {
        neon_project_id: "",
        current_database: "neondb",
      },
    ]),
  );
  const response = await productionDbIdentityResponse({
    isAuthenticated: async () => true,
    isProductionEnvironment: () => true,
    queryIdentity: async () => {
      throw new Error("Database identity check failed.");
    },
  });
  assert.equal(response.status, 503);
  const raw = await response.text();
  assert.match(raw, /Database identity check failed/);
  assert.doesNotMatch(raw, /neon_project_id/);
});

test("database errors fail closed without sensitive details", async () => {
  const response = await productionDbIdentityResponse({
    isAuthenticated: async () => true,
    isProductionEnvironment: () => true,
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
  assert.doesNotMatch(raw, /solitary-leaf/);
});

test("route wiring: queryProductionDatabaseIdentity through productionDbIdentityResponse", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  process.env.DATABASE_URL = "postgres://example/neondb";
  process.env.VERCEL_ENV = "production";
  let parseCount = 0;
  setSqlFactoryForTests(() => {
    const client = (async () => []) as unknown as NeonQueryFunction<false, false>;
    client.query = (async () => {
      parseCount += 1;
      return [identityRow];
    }) as unknown as NeonQueryFunction<false, false>["query"];
    return client;
  });
  try {
    const response = await productionDbIdentityResponse({
      isAuthenticated: async () => true,
      isProductionEnvironment: () => isProductionDbIdentityEnvironment(),
      queryIdentity: () => queryProductionDatabaseIdentity(),
    });
    assert.equal(response.status, 200);
    assert.equal(parseCount, 1);
    const body = await response.json();
    assert.equal(body.neon_project_id, "solitary-leaf-77946642");
    assert.equal(body.current_database, "neondb");
  } finally {
    resetSqlCacheForTests();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});

test("unexpected identity rows fail closed", () => {
  assert.throws(() => parseProductionDbIdentityRows([]));
  assert.throws(() =>
    parseProductionDbIdentityRows([
      {
        neon_project_id: "solitary-leaf-77946642",
        current_database: "neondb",
        database_url: "postgres://bad",
      },
    ]),
  );
  assert.throws(() =>
    parseProductionDbIdentityRows([
      {
        neon_project_id: "not a valid id!",
        current_database: "neondb",
      },
    ]),
  );
  assert.throws(() =>
    parseProductionDbIdentityRows([
      {
        neon_project_id: "solitary-leaf-77946642",
        current_database: "bad;drop",
      },
    ]),
  );
});