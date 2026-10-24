/**
 * Explicit-only database target resolution for QStash-primary schema migration.
 * Never reads DATABASE_URL, POSTGRES_URL, or .env.local.
 */

export const QSTASH_PRIMARY_SCHEMA_APPLY_AUTHORIZED_VALUE = "execute";
export const QSTASH_PRIMARY_SCHEMA_DRY_RUN_VALUE = "report";

export const QSTASH_PRIMARY_SCHEMA_ENV = {
  APPLY_AUTHORIZED: "MARKETING_QSTASH_PRIMARY_SCHEMA_APPLY_AUTHORIZED",
  DATABASE_URL: "MARKETING_QSTASH_PRIMARY_SCHEMA_DATABASE_URL",
  EXPECTED_HOST: "MARKETING_MIGRATION_EXPECTED_PG_HOST",
  EXPECTED_DATABASE: "MARKETING_MIGRATION_EXPECTED_PG_DATABASE",
  DRY_RUN: "MARKETING_QSTASH_PRIMARY_SCHEMA_DRY_RUN",
};

/**
 * @param {unknown} error
 * @param {string} code
 */
export function qstashPrimarySchemaError(code, error) {
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
export function isQstashPrimarySchemaDryRunReport(env = process.env) {
  return env[QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]?.trim() === QSTASH_PRIMARY_SCHEMA_DRY_RUN_VALUE;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function assertQstashPrimarySchemaApplyAuthorized(env = process.env) {
  const value = env[QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]?.trim();
  if (value !== QSTASH_PRIMARY_SCHEMA_APPLY_AUTHORIZED_VALUE) {
    throw qstashPrimarySchemaError("qstash_primary_schema_not_authorized");
  }
}

/**
 * Presence only — does not parse or log URL values.
 * @param {Record<string, string | undefined>} env
 */
export function readQstashPrimarySchemaDryRunPresence(env = process.env) {
  return {
    executeAuthorizationPresent:
      env[QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]?.trim() ===
      QSTASH_PRIMARY_SCHEMA_APPLY_AUTHORIZED_VALUE,
    dedicatedDatabaseUrlSupplied: Boolean(
      env[QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL]?.trim(),
    ),
    expectedHostSupplied: Boolean(env[QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_HOST]?.trim()),
    expectedDatabaseSupplied: Boolean(
      env[QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_DATABASE]?.trim(),
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
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  const protocol = url.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgresql" && protocol !== "postgres") {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  const path = url.pathname.replace(/^\//, "");
  if (!path) {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(path);
  } catch {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  if (!databaseName.trim()) {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  if (!url.username) {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_invalid");
  }

  return { hostname, databaseName };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ connectionString: string, hostname: string, databaseName: string }}
 */
export function resolveQstashPrimarySchemaDatabaseTarget(env = process.env) {
  const rawUrl = env[QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL]?.trim();
  if (!rawUrl) {
    throw qstashPrimarySchemaError("qstash_primary_schema_url_missing");
  }

  const expectedHost = env[QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_HOST]?.trim().toLowerCase();
  if (!expectedHost) {
    throw qstashPrimarySchemaError("qstash_primary_schema_target_mismatch");
  }

  const expectedDatabase = env[QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_DATABASE]?.trim();
  if (!expectedDatabase) {
    throw qstashPrimarySchemaError("qstash_primary_schema_target_mismatch");
  }

  const { hostname, databaseName } = parseDatabaseNameFromUrl(rawUrl);

  if (hostname !== expectedHost) {
    throw qstashPrimarySchemaError("qstash_primary_schema_target_mismatch");
  }

  if (databaseName !== expectedDatabase) {
    throw qstashPrimarySchemaError("qstash_primary_schema_target_mismatch");
  }

  return {
    connectionString: rawUrl,
    hostname,
    databaseName,
  };
}
