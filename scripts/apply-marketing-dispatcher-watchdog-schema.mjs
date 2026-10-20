import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { stripSqlLineComments } from "./apply-marketing-web-push-schema.mjs";
import {
  assertDispatcherWatchdogSchemaApplyAuthorized,
  dispatcherWatchdogSchemaError,
  DISPATCHER_WATCHDOG_SCHEMA_ENV,
  isDispatcherWatchdogSchemaDryRunReport,
  readDispatcherWatchdogSchemaDryRunPresence,
  resolveDispatcherWatchdogSchemaDatabaseTarget,
} from "./resolve-marketing-dispatcher-watchdog-schema-database-url.mjs";

export const DISPATCHER_WATCHDOG_SCHEMA_MIGRATION_ID = "marketing-dispatcher-watchdog-v1";
export const DISPATCHER_WATCHDOG_SCHEMA_ADVISORY_LOCK_KEY =
  "marketing_dispatcher_watchdog_schema_apply";

const MIGRATION_SQL_PATH = new URL(
  "../sql/marketing-dispatcher-watchdog.sql",
  import.meta.url,
);

const EXPECTED_SCHEMA = {
  marketing_dispatcher_watchdog_state: {
    columns: [
      { name: "id", dataType: "text", isNullable: "NO" },
      { name: "primary_qstash_activated_at", dataType: "timestamp with time zone", isNullable: "YES" },
      { name: "consecutive_stale_observations", dataType: "integer", isNullable: "NO" },
      { name: "last_primary_last_seen_at", dataType: "timestamp with time zone", isNullable: "YES" },
      { name: "last_committed_observation_slot_id", dataType: "bigint", isNullable: "NO" },
      { name: "last_observation_was_stale", dataType: "boolean", isNullable: "NO" },
      { name: "active_incident_id", dataType: "uuid", isNullable: "YES" },
      { name: "deferred_outage_push", dataType: "boolean", isNullable: "NO" },
      { name: "updated_at", dataType: "timestamp with time zone", isNullable: "NO" },
    ],
    primaryKey: ["id"],
  },
  marketing_dispatcher_watchdog_observations: {
    columns: [
      { name: "observation_slot_id", dataType: "bigint", isNullable: "NO" },
      { name: "observed_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "github_run_id", dataType: "text", isNullable: "YES" },
      { name: "github_run_attempt", dataType: "text", isNullable: "YES" },
      { name: "primary_last_seen_at", dataType: "timestamp with time zone", isNullable: "YES" },
      { name: "stale", dataType: "boolean", isNullable: "NO" },
      { name: "activation_pending", dataType: "boolean", isNullable: "NO" },
      { name: "outcome", dataType: "text", isNullable: "NO" },
    ],
    primaryKey: ["observation_slot_id"],
  },
  marketing_dispatcher_watchdog_incident_notifications: {
    columns: [
      { name: "incident_id", dataType: "uuid", isNullable: "NO" },
      { name: "outage_push_claim_status", dataType: "text", isNullable: "NO" },
      { name: "recovery_push_claim_status", dataType: "text", isNullable: "NO" },
      { name: "outage_push_sent_at", dataType: "timestamp with time zone", isNullable: "YES" },
      { name: "outage_push_claim_nonce", dataType: "uuid", isNullable: "YES" },
      { name: "outage_push_attempt_started_at", dataType: "timestamp with time zone", isNullable: "YES" },
      { name: "outage_push_admin_notification_id", dataType: "uuid", isNullable: "YES" },
      { name: "recovery_push_claim_nonce", dataType: "uuid", isNullable: "YES" },
      { name: "recovery_push_attempt_started_at", dataType: "timestamp with time zone", isNullable: "YES" },
      { name: "recovery_push_admin_notification_id", dataType: "uuid", isNullable: "YES" },
      { name: "created_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "updated_at", dataType: "timestamp with time zone", isNullable: "NO" },
    ],
    primaryKey: ["incident_id"],
  },
  marketing_dispatcher_maintenance_windows: {
    columns: [
      { name: "id", dataType: "uuid", isNullable: "NO" },
      { name: "starts_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "ends_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "reason", dataType: "text", isNullable: "NO" },
      { name: "created_by", dataType: "text", isNullable: "NO" },
      { name: "created_at", dataType: "timestamp with time zone", isNullable: "NO" },
    ],
    primaryKey: ["id"],
    indexes: [
      { name: "marketing_dispatcher_maintenance_ends_at_idx", column: "ends_at" },
      { name: "marketing_dispatcher_maintenance_starts_at_idx", column: "starts_at" },
    ],
  },
};

/**
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingDispatcherWatchdogMigrationStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 7) {
    throw new Error(
      `Expected 7 marketing dispatcher watchdog migration statements, got ${statements.length}.`,
    );
  }

  const expectedPrefixes = [
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_state",
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_observations",
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_incident_notifications",
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_maintenance_windows",
    "CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_ends_at_idx",
    "CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_starts_at_idx",
    "ALTER TABLE marketing_dispatcher_watchdog_incident_notifications",
  ];

  for (let i = 0; i < expectedPrefixes.length; i += 1) {
    const normalized = statements[i].replace(/\s+/g, " ");
    if (!normalized.startsWith(expectedPrefixes[i])) {
      throw new Error(
        `Statement ${i + 1} must start with "${expectedPrefixes[i]}".`,
      );
    }
  }

  if (statements.some((statement) => /WHERE\s+ends_at\s*>\s*now\s*\(\s*\)/i.test(statement))) {
    throw new Error("Volatile now() is not allowed in index predicates.");
  }

  return statements;
}

/**
 * @param {import("pg").PoolClient} client
 */
export async function verifyWatchdogMigrationPrerequisites(client) {
  const incidents = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'marketing_incidents'`,
  );
  if (incidents.rowCount !== 1) {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_prerequisite_missing");
  }
}

/**
 * @param {import("pg").PoolClient} client
 */
export async function verifyDispatcherWatchdogSchemaCompatibility(client) {
  for (const [tableName, spec] of Object.entries(EXPECTED_SCHEMA)) {
    const columnsResult = await client.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName],
    );

    if (columnsResult.rows.length !== spec.columns.length) {
      throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_incompatible");
    }

    for (let i = 0; i < spec.columns.length; i += 1) {
      const expected = spec.columns[i];
      const actual = columnsResult.rows[i];
      if (
        actual.column_name !== expected.name ||
        actual.data_type !== expected.dataType ||
        actual.is_nullable !== expected.isNullable
      ) {
        throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_incompatible");
      }
    }

    const pkResult = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = $1
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [tableName],
    );

    const pkColumns = pkResult.rows.map((row) => row.column_name);
    if (pkColumns.join(",") !== spec.primaryKey.join(",")) {
      throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_incompatible");
    }

    if (spec.indexes) {
      for (const index of spec.indexes) {
        const indexResult = await client.query(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
          [tableName, index.name],
        );
        if (indexResult.rowCount !== 1) {
          throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_incompatible");
        }
        const indexdef = String(indexResult.rows[0].indexdef).toLowerCase();
        if (!indexdef.includes(`(${index.column})`)) {
          throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_incompatible");
        }
      }
    }
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string[]} statements
 */
export async function applyDispatcherWatchdogSchemaStatementsInTransaction(client, statements) {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
      DISPATCHER_WATCHDOG_SCHEMA_ADVISORY_LOCK_KEY,
    ]);
    await verifyWatchdogMigrationPrerequisites(client);
    for (const statement of statements) {
      await client.query(statement);
    }
    await verifyDispatcherWatchdogSchemaCompatibility(client);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw dispatcherWatchdogSchemaError(
        "dispatcher_watchdog_schema_outcome_ambiguous",
        rollbackError,
      );
    }
    if (error && typeof error === "object" && "code" in error && error.code) {
      throw error;
    }
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_apply_failed", error);
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function buildDispatcherWatchdogSchemaDryRunReport(env = process.env) {
  const dryRun = env[DISPATCHER_WATCHDOG_SCHEMA_ENV.DRY_RUN]?.trim();
  if (dryRun && dryRun !== "report") {
    throw dispatcherWatchdogSchemaError("dispatcher_watchdog_schema_dry_run_invalid");
  }

  const file = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const statements = parseMarketingDispatcherWatchdogMigrationStatements(file);
  const presence = readDispatcherWatchdogSchemaDryRunPresence(env);

  return {
    mode: "dry_run",
    migrationId: DISPATCHER_WATCHDOG_SCHEMA_MIGRATION_ID,
    statementCount: statements.length,
    prerequisiteTables: ["marketing_incidents"],
    objects: [
      "marketing_dispatcher_watchdog_state",
      "marketing_dispatcher_watchdog_observations",
      "marketing_dispatcher_watchdog_incident_notifications",
      "marketing_dispatcher_maintenance_windows",
      "marketing_dispatcher_maintenance_ends_at_idx",
      "marketing_dispatcher_maintenance_starts_at_idx",
    ],
    requiredExecuteVariables: [
      DISPATCHER_WATCHDOG_SCHEMA_ENV.APPLY_AUTHORIZED,
      DISPATCHER_WATCHDOG_SCHEMA_ENV.DATABASE_URL,
      DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_HOST,
      DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_DATABASE,
    ],
    optionalDryRunVariable: DISPATCHER_WATCHDOG_SCHEMA_ENV.DRY_RUN,
    configuration: presence,
    databaseConnection: false,
    sqlExecuted: false,
  };
}

/**
 * @param {string} connectionString
 * @param {string[]} statements
 */
export async function applyMarketingDispatcherWatchdogSchema(connectionString, statements) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await applyDispatcherWatchdogSchemaStatementsInTransaction(client, statements);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export async function executeDispatcherWatchdogSchemaMigration(env = process.env) {
  if (isDispatcherWatchdogSchemaDryRunReport(env)) {
    return { dryRun: buildDispatcherWatchdogSchemaDryRunReport(env) };
  }

  assertDispatcherWatchdogSchemaApplyAuthorized(env);
  const target = resolveDispatcherWatchdogSchemaDatabaseTarget(env);
  const file = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const statements = parseMarketingDispatcherWatchdogMigrationStatements(file);
  await applyMarketingDispatcherWatchdogSchema(target.connectionString, statements);

  return {
    ok: true,
    migrationId: DISPATCHER_WATCHDOG_SCHEMA_MIGRATION_ID,
    statementCount: statements.length,
    targetHost: target.hostname,
    targetDatabase: target.databaseName,
    transactionCommitted: true,
    schemaVerificationPassed: true,
  };
}

function printSanitizedCliError(error) {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "dispatcher_watchdog_schema_apply_failed";
  console.error(code);
}

async function main() {
  const result = await executeDispatcherWatchdogSchemaMigration(process.env);
  if (result.dryRun) {
    console.log(JSON.stringify(result.dryRun));
    return;
  }
  console.log(
    JSON.stringify({
      ok: true,
      migrationId: result.migrationId,
      statementCount: result.statementCount,
      targetHost: result.targetHost,
      targetDatabase: result.targetDatabase,
      transactionCommitted: result.transactionCommitted,
      schemaVerificationPassed: result.schemaVerificationPassed,
    }),
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]));

if (isMain) {
  main().catch((error) => {
    printSanitizedCliError(error);
    process.exit(1);
  });
}
