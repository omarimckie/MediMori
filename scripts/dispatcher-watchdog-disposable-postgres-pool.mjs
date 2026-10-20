/**
 * Disposable-local-only PostgreSQL connectivity via native TCP (node-pg).
 * Used only by dispatcher watchdog disposable integration infrastructure.
 */
import pg from "pg";

export const DISPOSABLE_WATCHDOG_PG_DRIVER_ID = "node-pg-native-tcp";

/** Bounded wait when opening a pooled connection (disposable integration only). */
export const DISPOSABLE_PG_POOL_CONNECTION_TIMEOUT_MS = 15_000;

/**
 * @param {string} connectionString resolved disposable URL (caller must not log)
 * @returns {pg.Pool}
 */
export function createDisposableWatchdogPgPool(connectionString) {
  if (typeof connectionString !== "string" || connectionString.trim().length === 0) {
    throw new Error("disposable_pg_connection_string_invalid");
  }
  return new pg.Pool({
    connectionString,
    connectionTimeoutMillis: DISPOSABLE_PG_POOL_CONNECTION_TIMEOUT_MS,
    max: 10,
    ssl: false,
  });
}

/**
 * @param {unknown} error
 * @returns {{ name: string, message: string, code?: string }}
 */
function redactPostgresUrlSecrets(text) {
  return String(text).replace(/postgresql:\/\/[^\s'"]+/gi, "postgresql://[redacted]");
}

export function formatDisposablePostgresConnectionError(error) {
  if (error instanceof Error) {
    const out = {
      name: error.name,
      message: redactPostgresUrlSecrets(error.message),
    };
    if (typeof error.code === "string" && error.code.length > 0) {
      out.code = error.code;
    }
    return out;
  }
  if (error && typeof error === "object" && "type" in error) {
    return {
      name: "ConnectionError",
      message: "disposable_postgres_connection_failed",
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}
