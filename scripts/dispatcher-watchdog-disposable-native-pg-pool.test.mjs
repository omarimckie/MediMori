import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import {
  APPROVED_INTEGRATION_POSTGRES_IMAGE_REF,
  APPROVED_INTEGRATION_RUNNER_IMAGE_REF,
} from "./dispatcher-watchdog-integration-wrapper-lib.mjs";
import {
  DISPOSABLE_PG_POOL_CONNECTION_TIMEOUT_MS,
  DISPOSABLE_WATCHDOG_PG_DRIVER_ID,
  createDisposableWatchdogPgPool,
  formatDisposablePostgresConnectionError,
} from "./dispatcher-watchdog-disposable-postgres-pool.mjs";
import {
  DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
  expectedDisposablePgHostname,
  resolveMarketingDispatcherWatchdogTestDatabaseUrl,
} from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";
import {
  OFFLINE_RUNTIME_ROOT_PACKAGES,
  RUNNER_SOURCE_ALLOWLIST,
  collectOfflinePackageClosure,
} from "./dispatcher-watchdog-runner-snapshot.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function env(overrides = {}) {
  const runId = "run-native-pg-test";
  const host = expectedDisposablePgHostname(runId);
  return {
    MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
    MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: `postgresql://u:p@${host}:5432/db`,
    MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: host,
    MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: runId,
    ...overrides,
  };
}

function readRepo(rel) {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
}

describe("dispatcher watchdog disposable native pg pool (T1–T30)", () => {
  it("T1 native disposable pool factory imports pg", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(src, /import pg from "pg"/);
    assert.match(src, /new pg\.Pool/);
    assert.equal(DISPOSABLE_WATCHDOG_PG_DRIVER_ID, "node-pg-native-tcp");
  });

  it("T2 factory does not import @neondatabase/serverless", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(src, /@neondatabase\/serverless/);
    assert.doesNotMatch(src, /neonConfig/);
  });

  it("T3 factory does not mutate neonConfig", () => {
    const before = {
      useSecureWebSocket: neonConfig.useSecureWebSocket,
      forceDisablePgSSL: neonConfig.forceDisablePgSSL,
      pipelineConnect: neonConfig.pipelineConnect,
      webSocketConstructor: neonConfig.webSocketConstructor,
    };
    createDisposableWatchdogPgPool(
      resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({})),
    );
    assert.equal(neonConfig.useSecureWebSocket, before.useSecureWebSocket);
    assert.equal(neonConfig.forceDisablePgSSL, before.forceDisablePgSSL);
    assert.equal(neonConfig.pipelineConnect, before.pipelineConnect);
    assert.equal(neonConfig.webSocketConstructor, before.webSocketConstructor);
  });

  it("T4 factory creates pg.Pool with expected sanitized configuration", () => {
    const url = resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({}));
    const pool = createDisposableWatchdogPgPool(url);
    assert.equal(typeof pool.connect, "function");
    assert.equal(typeof pool.end, "function");
    assert.equal(pool.options.connectionTimeoutMillis, DISPOSABLE_PG_POOL_CONNECTION_TIMEOUT_MS);
    assert.equal(pool.options.ssl, false);
    assert.equal(pool.options.max, 10);
    assert.equal(typeof pool.options.connectionString, "string");
    assert.match(pool.options.connectionString, /tf-watchdog-pg-run-native-pg-test:5432/);
  });

  it("T5 no database connection occurs during module import", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(src, /^await /m);
    assert.doesNotMatch(src, /\.connect\(\)/);
    assert.doesNotMatch(src, /pool\.query/);
  });

  it("T6 strict disposable URL resolver executes before pool construction", () => {
    const applySrc = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    const mainIdx = applySrc.indexOf("async function main");
    const mainBody = applySrc.slice(mainIdx, mainIdx + 400);
    const resolveIdx = mainBody.indexOf("resolveMarketingDispatcherWatchdogTestDatabaseUrl");
    const applyIdx = mainBody.indexOf("applyDisposableWatchdogSchemas");
    assert.ok(resolveIdx >= 0 && applyIdx >= 0);
    assert.ok(resolveIdx < applyIdx);
    const integrationSrc = readRepo(
      "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
    );
    assert.match(integrationSrc, /resolveMarketingDispatcherWatchdogTestDatabaseUrl\(\)/);
    assert.match(integrationSrc, /createDisposableWatchdogPgPool\(connectionString\)/);
  });

  it("T7 missing disposable authorization fails closed", () => {
    assert.throws(
      () => resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({ MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: undefined })),
      /allow_missing_or_invalid/,
    );
  });

  it("T8 invalid database host fails closed", () => {
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

  it("T9 production database URL fallback is prohibited", () => {
    const resolver = readFileSync(
      fileURLToPath(new URL("./resolve-marketing-dispatcher-watchdog-test-database-url.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(resolver, /process\.env\.DATABASE_URL/);
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl({
          ...env({}),
          MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: undefined,
          DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-run-native-pg-test:5432/db",
        }),
      /database_url_missing/,
    );
  });

  it("T10 credentials are not logged", () => {
    const poolSrc = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(poolSrc, /console\.(log|info|debug|error)\([^)]*connectionString/);
    const formatted = formatDisposablePostgresConnectionError(new Error("secret postgresql://u:p@host/db"));
    assert.match(formatted.message, /\[redacted\]/);
    assert.doesNotMatch(JSON.stringify(formatted), /u:p@/);
  });

  it("T11 connection errors remain sanitized", () => {
    const formatted = formatDisposablePostgresConnectionError(
      Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    assert.equal(formatted.code, "ECONNREFUSED");
    assert.doesNotMatch(JSON.stringify(formatted), /postgresql:\/\//);
  });

  it("T12 connection timeouts remain bounded", () => {
    assert.equal(DISPOSABLE_PG_POOL_CONNECTION_TIMEOUT_MS, 15_000);
    const pool = createDisposableWatchdogPgPool(resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({})));
    assert.equal(pool.options.connectionTimeoutMillis, DISPOSABLE_PG_POOL_CONNECTION_TIMEOUT_MS);
  });

  it("T13 schema application uses native disposable pool", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(src, /dispatcher-watchdog-disposable-postgres-pool\.mjs/);
    assert.match(src, /createDisposableWatchdogPgPool/);
    assert.doesNotMatch(src, /tcp-shim-legacy/);
    assert.doesNotMatch(src, /@neondatabase\/serverless/);
  });

  it("T14 SQL schema order is unchanged", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    const incidentsIdx = src.indexOf("marketing-incidents.sql");
    const watchdogIdx = src.indexOf("marketing-dispatcher-watchdog.sql");
    const qstashIdx = src.indexOf("marketing-dispatcher-qstash-primary.sql");
    assert.ok(incidentsIdx >= 0 && watchdogIdx > incidentsIdx && qstashIdx > watchdogIdx);
    assert.match(src, /parseMarketingDispatcherQstashPrimaryMigrationStatements/);
    assert.match(src, /\[\.\.\.incidents, \.\.\.watchdog, \.\.\.qstashPrimary\]/);
  });

  it("T15 transaction rollback behavior is preserved", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(src, /await client\.query\("BEGIN"\)/);
    assert.match(src, /await client\.query\("COMMIT"\)/);
    assert.match(src, /await client\.query\("ROLLBACK"\)/);
  });

  it("T16 client release behavior is preserved", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(src, /client\.release\(\)/);
  });

  it("T17 pool shutdown behavior is preserved", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-apply-schemas-disposable.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(src, /await pool\.end\(\)/);
  });

  it("T18 integration suite uses native disposable pool", () => {
    const src = readRepo(
      "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
    );
    assert.match(src, /from "\.\/disposable-postgres-pool"/);
    assert.match(src, /createDisposableWatchdogPgPool/);
    const helper = readRepo(
      "src/lib/marketing/reliability/dispatcher-watchdog/disposable-postgres-pool.ts",
    );
    assert.match(helper, /dispatcher-watchdog-disposable-postgres-pool\.mjs/);
  });

  it("T19 all 25 integration cases remain present", () => {
    const src = readRepo(
      "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
    );
    assert.equal(src.match(/\bit\(/g)?.length, 25);
    const qstashSrc = readRepo(
      "src/lib/marketing/reliability/qstash-primary/qstash-primary-postgres.integration.test.ts",
    );
    assert.equal(qstashSrc.match(/\bit\(/g)?.length, 21);
  });

  it("T20 integration tests remain gated by disposable-only authorization", () => {
    for (const rel of [
      "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
      "src/lib/marketing/reliability/qstash-primary/qstash-primary-postgres.integration.test.ts",
    ]) {
      const src = readRepo(rel);
      assert.match(src, /skip: !integrationEnabled/);
      assert.match(src, /isDispatcherWatchdogIntegrationConfigured/);
    }
  });

  it("T21 offline runner includes pg and required runtime dependencies", () => {
    assert.ok(OFFLINE_RUNTIME_ROOT_PACKAGES.includes("pg"));
    assert.ok(OFFLINE_RUNTIME_ROOT_PACKAGES.includes("@upstash/qstash"));
    const closure = collectOfflinePackageClosure(repoRoot);
    assert.ok(closure.includes("pg"));
    assert.ok(closure.includes("pg-pool"));
    assert.ok(closure.includes("pg-connection-string"));
    assert.ok(closure.includes("@upstash/qstash"));
  });

  it("T22 offline runner does not install packages at runtime", () => {
    const snapshot = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-runner-snapshot.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(snapshot, /\bnpm (install|ci)\b/);
    assert.doesNotMatch(snapshot, /\bpnpm (add|install)\b/);
  });

  it("T23 offline runner does not require the TCP shim", () => {
    assert.ok(RUNNER_SOURCE_ALLOWLIST.includes("scripts/dispatcher-watchdog-disposable-postgres-pool.mjs"));
    assert.equal(
      RUNNER_SOURCE_ALLOWLIST.includes("scripts/dispatcher-watchdog-disposable-postgres-tcp-shim-legacy.mjs"),
      false,
    );
    const poolSrc = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(poolSrc, /tcp-shim-legacy/);
  });

  it("T24 production Neon imports remain unchanged", () => {
    const repo = readRepo("src/lib/marketing/reliability/dispatcher-watchdog/repository.ts");
    assert.match(repo, /@neondatabase\/serverless/);
    assert.doesNotMatch(repo, /disposable-postgres-pool/);
    const incidents = readRepo("src/lib/marketing/incidents/postgres-repository.ts");
    assert.match(incidents, /@neondatabase\/serverless/);
  });

  it("T25 no Docker execution occurs during offline tests", () => {
    const poolSrc = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-disposable-postgres-pool.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(poolSrc, /\bspawn\([^)]*docker/i);
    assert.doesNotMatch(poolSrc, /execSync\([^)]*docker/i);
  });

  it("T26 no database connection occurs during offline tests", () => {
    const pool = createDisposableWatchdogPgPool(resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({})));
    assert.equal(pool.totalCount, 0);
    assert.equal(pool.idleCount, 0);
    assert.equal(pool.waitingCount, 0);
  });

  it("T27 no production credentials are read", () => {
    const resolver = readFileSync(
      fileURLToPath(new URL("./resolve-marketing-dispatcher-watchdog-test-database-url.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(resolver, /readFileSync\([^)]*\.env\.local/);
    assert.doesNotMatch(resolver, /process\.env\.DATABASE_URL/);
    assert.doesNotMatch(resolver, /env\.DATABASE_URL/);
  });

  it("T28 existing pinned-image references remain unchanged", () => {
    assert.equal(
      APPROVED_INTEGRATION_POSTGRES_IMAGE_REF,
      "postgres@sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166",
    );
    assert.equal(
      APPROVED_INTEGRATION_RUNNER_IMAGE_REF,
      "node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402",
    );
  });

  it("T29 existing --pull=never behavior remains unchanged", () => {
    const wrapper = readFileSync(
      fileURLToPath(new URL("./run-dispatcher-watchdog-postgres-integration.ps1", import.meta.url)),
      "utf8",
    );
    assert.match(wrapper, /--pull=never/);
  });

  it("T30 existing Docker isolation protections remain unchanged", () => {
    const dockerRun = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-integration-docker-run.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(dockerRun, /--read-only/);
    assert.match(dockerRun, /DOCKER_RUN_PULL_NEVER/);
    const volumePolicy = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-docker-isolation-volume.test.mjs", import.meta.url)),
      "utf8",
    );
    assert.match(volumePolicy, /:\/work:ro/);
  });
});
