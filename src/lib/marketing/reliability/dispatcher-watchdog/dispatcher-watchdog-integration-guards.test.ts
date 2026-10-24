import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
  expectedDisposablePgHostname,
  isDispatcherWatchdogIntegrationConfigured,
  resolveMarketingDispatcherWatchdogTestDatabaseUrl,
  tryResolveMarketingDispatcherWatchdogTestDatabaseUrl,
} from "../../../../../scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs";

describe("dispatcher watchdog integration URL resolver", () => {
  const runId = "run-abc123";
  const host = expectedDisposablePgHostname(runId);
  const validUrl = `postgresql://watchdog_user:secret@${host}:5432/watchdog_disposable`;

  function env(overrides: Record<string, string | undefined>) {
    return {
      MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
      MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: validUrl,
      MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: host,
      MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: runId,
      ...overrides,
    };
  }

  it("resolves when all guards match", () => {
    const resolved = resolveMarketingDispatcherWatchdogTestDatabaseUrl(env({}));
    assert.equal(resolved, validUrl);
  });

  it("rejects missing allow opt-in", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({ MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: undefined }),
        ),
      /allow_missing_or_invalid/,
    );
  });

  it("rejects neon production host markers", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL:
              "postgresql://u:p@ep-muddy-math-auxmesyz.neon.tech:5432/db",
            MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST:
              "ep-muddy-math-auxmesyz.neon.tech",
          }),
        ),
      /host_forbidden|host_identity_mismatch|expected_pg_host_mismatch/,
    );
  });

  it("rejects localhost and host.docker.internal", () => {
    for (const forbiddenHost of ["localhost", "host.docker.internal", "127.0.0.1"]) {
      assert.throws(
        () =>
          resolveMarketingDispatcherWatchdogTestDatabaseUrl(
            env({
              MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: `postgresql://u:p@${forbiddenHost}:5432/db`,
              MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: forbiddenHost,
            }),
          ),
        /host_forbidden|host_identity_mismatch|expected_pg_host_mismatch/,
      );
    }
  });

  it("rejects hostname that does not match run identity", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: `postgresql://u:p@tf-watchdog-pg-other:5432/db`,
          }),
        ),
      /host_identity_mismatch/,
    );
  });

  it("rejects redirect-style query parameters", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: `${validUrl}?host=evil.example`,
          }),
        ),
      /forbidden_query_param/,
    );
  });

  it("isDispatcherWatchdogIntegrationConfigured requires successful resolve", () => {
    assert.equal(isDispatcherWatchdogIntegrationConfigured({}), false);
    assert.equal(tryResolveMarketingDispatcherWatchdogTestDatabaseUrl({}), null);
    assert.equal(isDispatcherWatchdogIntegrationConfigured(env({})), true);
    assert.equal(
      isDispatcherWatchdogIntegrationConfigured(
        env({ MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-other:5432/db" }),
      ),
      false,
    );
  });

  it("rejects dotted disposable hostnames", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl(
          env({
            MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: "run.evil",
            MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "tf-watchdog-pg-run.evil",
            MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL:
              "postgresql://u:p@tf-watchdog-pg-run.evil:5432/db",
          }),
        ),
      /host_forbidden/,
    );
  });
});
