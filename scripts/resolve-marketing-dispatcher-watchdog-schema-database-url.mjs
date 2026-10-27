/**
 * Explicit-only database target resolution for dispatcher-watchdog schema migration.
 * Never reads DATABASE_URL, POSTGRES_URL, or .env.local.
 */

export const DISPATCHER_WATCHDOG_SCHEMA_APPLY_AUTHORIZED_VALUE = "execute";
export const DISPATCHER_WATCHDOG_SCHEMA_DRY_RUN_VALUE = "report";

export const DISPATCHER_WATCHDOG_SCHEMA_ENV = {
  APPLY_AUTHORIZED: "MARKETING_DISPATCHER_WATCHDOG_SCHEMA_APPLY_AUTHORIZED",
  DATABASE_URL: "MARKETING_DISPATCHER_WATCHDOG_SCHEMA_DATABASE_URL",
  EXPECTED_HOST: "MARKETING_MIGRATION_EXPECTED_PG_HOST",
  EXPECTED_DATABASE: "MARKETING_MIGRATION_EXPECTED_PG_DATABASE",
  DRY_RUN: "MARKETING_DISPATCHER_WATCHDOG_SCHEMA_DRY_RUN",
};

/**
 * @param {unknown} error
 * @param {string} code
 */
export function dispatcherWatchdogSchemaError(code, error) {
  const err = new Error(code);
  err.code = code;
  if (error instanceof Error && error.message && !error.message.includes("postgresql://")) {
    err.cause = error;
  }
  return err;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function isDispatcherWatchdogSchemaDryRunReport(env = process.env) {
  return (
    env[DISPATCHER_WATCHDOG_SCHEMA_ENV.DRY_RUN]?.trim() ===
    DISPATCHER_WATCHDOG_SCHEMA_DRY_RUN_VALUE
  );
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function assertDispatcherWatchdogSchemaApplyAuthorized(env = process.env) {
  const value = env[DISPATCHER_WATCHDOG_SCHEMA_ENV.APPLY_AUTHORIZED]?.trim();
  if (value !== DISPATCHER_WATCHDOG_SCHEMA_APPLY_AUTHORIZED_VALUE) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_not_authorized");
  }
}

/**
 * Presence only — does not parse or log URL values.
 * @param {Record<string, string | undefined>} env
 */
export function readDispatcherWatchdogSchemaDryRunPresence(env = process.env) {
  return {
    executeAuthorizationPresent:
      env[DISPATCHER_WATCHDOG_SCHEMA_ENV.APPLY_AUTHORIZED]?.trim() ===
      DISPATCHER_WATCHDOG_SCHEMA_APPLY_AUTHORIZED_VALUE,
    dedicatedDatabaseUrlSupplied: Boolean(
      env[DISPATCHER_WATCHDOG_SCHEMA_ENV.DATABASE_URL]?.trim(),
    ),
    expectedHostSupplied: Boolean(env[DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_HOST]?.trim()),
    expectedDatabaseSupplied: Boolean(
      env[DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_DATABASE]?.trim(),
    ),
  };
}

/**
 * @param {string} rawUrl
 */
function parseDatabaseNameFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  const protocol = url.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgresql" && protocol !== "postgres") {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  const path = url.pathname.replace(/^\//, "");
  if (!path) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(path);
  } catch {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  if (!databaseName.trim()) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  if (!url.username) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_invalid");
  }

  return { hostname, databaseName };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ connectionString: string, hostname: string, databaseName: string }}
 */
export function resolveDispatcherWatchdogSchemaDatabaseTarget(env = process.env) {
  const rawUrl = env[DISPATCHER_WATCHDOG_SCHEMA_ENV.DATABASE_URL]?.trim();
  if (!rawUrl) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_url_missing");
  }

  const expectedHost = env[DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_HOST]?.trim().toLowerCase();
  if (!expectedHost) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_target_mismatch");
  }

  const expectedDatabase = env[DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_DATABASE]?.trim();
  if (!expectedDatabase) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_target_mismatch");
  }

  const { hostname, databaseName } = parseDatabaseNameFromUrl(rawUrl);

  if (hostname !== expectedHost) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_target_mismatch");
  }

  if (databaseName !== expectedDatabase) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_target_mismatch");
  }

  return {
    connectionString: rawUrl,
    hostname,
    databaseName,
  };
}
