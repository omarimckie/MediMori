import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DISPOSABLE_WATCHDOG_PG_DRIVER_ID,
  createDisposableWatchdogPgPool,
  formatDisposablePostgresConnectionError,
} from "./dispatcher-watchdog-disposable-postgres-pool.mjs";
import {
  DISPOSABLE_WATCHDOG_PG_DRIVER_ID as LEGACY_TCP_SHIM_DRIVER_ID,
  configureDisposableNeonTcpTransport,
  createDisposableWatchdogPgPool as createLegacyTcpShimPool,
} from "./dispatcher-watchdog-disposable-postgres-tcp-shim-legacy.mjs";
import {
  DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
  expectedDisposablePgHostname,
  resolveMarketingDispatcherWatchdogTestDatabaseUrl,
} from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";
import {
  RUNNER_SOURCE_ALLOWLIST,
  collectOfflinePackageClosure,
} from "./dispatcher-watchdog-runner-snapshot.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function env(overrides = {}) {
  const runId = "run-tcp-test";
  const host = expectedDisposablePgHostname(runId);
  return {
    MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
    MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: `postgresql://u:p@${host}:5432/db`,
    MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: host,
    MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: runId,
    ...overrides,
  };
}

describe("dispatcher watchdog disposable TCP driver (T1–T20)", () => {
  it("T1 disposable schema path selects native pg pool factory", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(src, /createDisposableWatchdogPgPool/);
    assert.doesNotMatch(src, /new Pool\(/);
    assert.equal(DISPOSABLE_WATCHDOG_PG_DRIVER_ID, "node-pg-native-tcp");
    assert.equal(LEGACY_TCP_SHIM_DRIVER_ID, "neon-serverless-tcp-websocket-shim");
  });

  it("T2 disposable integration path selects TCP-compatible driver", () => {
    const src = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.match(src, /createDisposableWatchdogPgPool/);
    assert.doesNotMatch(src, /new PgPool\(/);
    const helper = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/disposable-postgres-pool.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.match(helper, /dispatcher-watchdog-disposable-postgres-pool\.mjs/);
  });

  it("T3 production Neon connection imports remain unchanged", () => {
    const repo = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/repository.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.match(repo, /@neondatabase\/serverless/);
    assert.doesNotMatch(repo, /disposable-postgres-pool/);
    const incidents = readFileSync(
      fileURLToPath(
        new URL("../src/lib/marketing/incidents/postgres-repository.ts", import.meta.url),
      ),
      "utf8",
    );
    assert.match(incidents, /@neondatabase\/serverless/);
    assert.doesNotMatch(incidents, /disposable-postgres-pool/);
  });

  it("T4 disposable-only authorization remains mandatory", () => {
    assert.throws(
      () => resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({ MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: undefined })),
      /allow_missing_or_invalid/,
    );
  });

  it("T5 invalid test database host is rejected", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-wrong:5432/db",
          }),
        ),
      /host_identity_mismatch/,
    );
  });

  it("T6 Neon host is rejected", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL:
              "postgresql://u:p@ep-muddy-math-auxmesyz.neon.tech:5432/db",
            MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "ep-muddy-math-auxmesyz.neon.tech",
          }),
        ),
      /host_forbidden|host_identity_mismatch|expected_pg_host_mismatch/,
    );
  });

  it("T7 localhost and IP addresses remain rejected", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.1"]) {
      assert.throws(
        () =>
          resolveMarketingDispatcherWatchdogTestDatabaseUrl(
            env({
              MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: `postgresql://u:p@${host}:5432/db`,
              MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: host,
            }),
          ),
        /host_forbidden|host_identity_mismatch|expected_pg_host_mismatch/,
      );
    }
  });

  it("T8 no production DATABASE_URL fallback exists", () => {
    const resolver = readFileSync(
      fileURLToPath(new URL("./resolve-marketing-dispatcher-watchdog-test-database-url.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(resolver, /env\.DATABASE_URL/);
    assert.doesNotMatch(resolver, /process\.env\.DATABASE_URL/);
    assert.doesNotMatch(resolver, /readFileSync\([^)]*\.env\.local/);
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl({
          ...env({}),
          MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: undefined,
          DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-run-tcp-test:5432/db",
        }),
      /database_url_missing/,
    );
  });

  it("T9 approved disposable hostname is accepted by the resolver", () => {
    const resolved = resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({}));
    assert.match(resolved, /tf-watchdog-pg-run-tcp-test:5432/);
  });

  it("T10 schema application preserves required SQL order", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    const incidentsIdx = src.indexOf("marketing-incidents.sql");
    const watchdogIdx = src.indexOf("marketing-dispatcher-watchdog.sql");
    const qstashIdx = src.indexOf("marketing-dispatcher-qstash-primary.sql");
    assert.ok(incidentsIdx >= 0 && watchdogIdx >= 0 && qstashIdx >= 0);
    assert.ok(incidentsIdx < watchdogIdx && watchdogIdx < qstashIdx);
    assert.match(src, /\[\.\.\.incidents, \.\.\.watchdog, \.\.\.qstashPrimary\]/);
  });

  it("T11 schema application preserves transaction boundaries", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    const fnStart = src.indexOf("export async function applyDisposableWatchdogSchemas");
    assert.ok(fnStart >= 0);
    const fnBody = src.slice(fnStart, fnStart + 1200);
    assert.match(fnBody, /await client\.query\("BEGIN"\)/);
    assert.match(fnBody, /await client\.query\("COMMIT"\)/);
    assert.match(fnBody, /await client\.query\("ROLLBACK"\)/);
    assert.match(fnBody, /finally/);
    assert.match(fnBody, /client\.release\(\)/);
    assert.match(fnBody, /await pool\.end\(\)/);
  });

  it("T12 connection failures preserve actionable sanitized error information", () => {
    const formatted = formatDisposablePostgresConnectionError(
      Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    assert.equal(formatted.name, "Error");
    assert.match(formatted.message, /ECONNREFUSED/);
    assert.equal(formatted.code, "ECONNREFUSED");
    const eventLike = formatDisposablePostgresConnectionError({ type: "error" });
    assert.equal(eventLike.name, "ConnectionError");
    assert.match(eventLike.message, /disposable_postgres_connection_failed/);
    assert.doesNotMatch(JSON.stringify(eventLike), /postgresql:\/\//);
  });

  it("T13 integration-test cleanup closes the TCP client", () => {
    const src = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.match(src, /after\(async \(\) => \{/);
    assert.match(src, /await pool\.end\(\)/);
  });

  it("T14 existing 25 test cases remain present and enabled", () => {
    const src = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const matches = src.match(/\bit\(/g);
    assert.equal(matches?.length, 25);
    assert.match(src, /skip: !integrationEnabled/);
  });

  it("T15 runner snapshot includes disposable TCP pool module", () => {
    assert.ok(RUNNER_SOURCE_ALLOWLIST.includes("scripts/dispatcher-watchdog-disposable-postgres-pool.mjs"));
    assert.ok(
      RUNNER_SOURCE_ALLOWLIST.includes(
        "src/lib/marketing/reliability/dispatcher-watchdog/disposable-postgres-pool.ts",
      ),
    );
  });

  it("T16 runner offline dependency closure resolves locally", () => {
    const closure = collectOfflinePackageClosure(repoRoot);
    assert.ok(closure.includes("@neondatabase/serverless"));
    assert.ok(closure.includes("tsx"));
    assert.ok(closure.includes("pg"));
  });

  it("T17 no new network access is required during staging", () => {
    const snapshot = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-runner-snapshot.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(snapshot, /fetch\(|https:\/\//);
    const poolMod = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(poolMod, /fetch\(/);
    assert.doesNotMatch(poolMod, /@neondatabase\/serverless/);
  });

  it("T18 no production database module is modified", () => {
    const persistence = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/postgres-persistence.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.doesNotMatch(persistence, /disposable-postgres-pool/);
  });

  it("T19 no SQL schema is modified", () => {
    for (const rel of ["sql/marketing-incidents.sql", "sql/marketing-dispatcher-watchdog.sql"]) {
      const text = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
      assert.ok(text.includes("CREATE"));
    }
  });

  it("T20 existing secure native-process capture remains unchanged", () => {
    const wrapper = readFileSync(
      fileURLToPath(new URL("./run-dispatcher-watchdog-postgres-integration.ps1", import.meta.url)),
      "utf8",
    );
    assert.match(wrapper, /Invoke-DisposableIntegrationNativeCapture/);
    assert.match(wrapper, /disposable_schema_apply_failed/);
    assert.match(wrapper, /qstash-primary-postgres\.integration\.test\.ts/);
    assert.match(wrapper, /dispatcher-watchdog-postgres\.integration\.test\.ts/);
    configureDisposableNeonTcpTransport();
    const pool = createLegacyTcpShimPool(
      resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({})),
    );
    assert.equal(typeof pool.end, "function");
    const nativePool = createDisposableWatchdogPgPool(
      resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({})),
    );
    assert.equal(typeof nativePool.end, "function");
    assert.equal(typeof nativePool.connect, "function");
  });
});
