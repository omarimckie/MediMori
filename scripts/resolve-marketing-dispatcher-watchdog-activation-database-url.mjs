/**
 * Explicit-only database target resolution for dispatcher-watchdog activation tooling.
 * Never reads DATABASE_URL, POSTGRES_URL, or .env.local.
 */

export const DISPATCHER_WATCHDOG_ACTIVATION_APPLY_AUTHORIZED_VALUE = "execute";
export const DISPATCHER_WATCHDOG_ACTIVATION_DRY_RUN_VALUE = "report";
export const DISPATCHER_WATCHDOG_ACTIVATION_SNAPSHOT_VALUE = "report";

export const DISPATCHER_WATCHDOG_ACTIVATION_ENV = {
  APPLY_AUTHORIZED: "MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_AUTHORIZED",
  DATABASE_URL: "MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_DATABASE_URL",
  EXPECTED_HOST: "MARKETING_MIGRATION_EXPECTED_PG_HOST",
  EXPECTED_DATABASE: "MARKETING_MIGRATION_EXPECTED_PG_DATABASE",
  DRY_RUN: "MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_DRY_RUN",
  SNAPSHOT: "MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_SNAPSHOT",
};

/**
 * @param {unknown} error
 * @param {string} code
 */
export function dispatcherWatchdogActivationError(code, error) {
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
export function isDispatcherWatchdogActivationDryRunReport(env = process.env) {
  return (
    env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.DRY_RUN]?.trim() ===
    DISPATCHER_WATCHDOG_ACTIVATION_DRY_RUN_VALUE
  );
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function isDispatcherWatchdogActivationSnapshotReport(env = process.env) {
  return (
    env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.SNAPSHOT]?.trim() ===
    DISPATCHER_WATCHDOG_ACTIVATION_SNAPSHOT_VALUE
  );
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function assertDispatcherWatchdogActivationAuthorized(env = process.env) {
  const value = env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.APPLY_AUTHORIZED]?.trim();
  if (value !== DISPATCHER_WATCHDOG_ACTIVATION_APPLY_AUTHORIZED_VALUE) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_not_authorized");
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function readDispatcherWatchdogActivationDryRunPresence(env = process.env) {
  return {
    executeAuthorizationPresent:
      env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.APPLY_AUTHORIZED]?.trim() ===
      DISPATCHER_WATCHDOG_ACTIVATION_APPLY_AUTHORIZED_VALUE,
    dedicatedDatabaseUrlSupplied: Boolean(
      env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.DATABASE_URL]?.trim(),
    ),
    expectedHostSupplied: Boolean(env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_HOST]?.trim()),
    expectedDatabaseSupplied: Boolean(
      env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_DATABASE]?.trim(),
    ),
    snapshotModeRequested:
      env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.SNAPSHOT]?.trim() ===
      DISPATCHER_WATCHDOG_ACTIVATION_SNAPSHOT_VALUE,
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
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  const protocol = url.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgresql" && protocol !== "postgres") {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  const path = url.pathname.replace(/^\//, "");
  if (!path) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(path);
  } catch {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  if (!databaseName.trim()) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  if (!url.username) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_invalid");
  }

  return { hostname, databaseName };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ connectionString: string, hostname: string, databaseName: string }}
 */
export function resolveDispatcherWatchdogActivationDatabaseTarget(env = process.env) {
  const rawUrl = env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.DATABASE_URL]?.trim();
  if (!rawUrl) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_url_missing");
  }

  const expectedHost = env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_HOST]?.trim().toLowerCase();
  if (!expectedHost) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_target_mismatch");
  }

  const expectedDatabase = env[DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_DATABASE]?.trim();
  if (!expectedDatabase) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_target_mismatch");
  }

  const { hostname, databaseName } = parseDatabaseNameFromUrl(rawUrl);

  if (hostname !== expectedHost) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_target_mismatch");
  }

  if (databaseName !== expectedDatabase) {
    throw dispatcherWatchdogActivationError("dispatcher_watchdog_activation_target_mismatch");
  }

  return {
    connectionString: rawUrl,
    hostname,
    databaseName,
  };
}
