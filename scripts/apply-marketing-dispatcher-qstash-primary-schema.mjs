import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { stripSqlLineComments } from "./apply-marketing-web-push-schema.mjs";
import {
  assertQstashPrimarySchemaApplyAuthorized,
  isQstashPrimarySchemaDryRunReport,
  QSTASH_PRIMARY_SCHEMA_ENV,
  readQstashPrimarySchemaDryRunPresence,
  resolveQstashPrimarySchemaDatabaseTarget,
  qstashPrimarySchemaError,
} from "./resolve-marketing-qstash-primary-schema-database-url.mjs";

export const QSTASH_PRIMARY_SCHEMA_MIGRATION_ID = "marketing-dispatcher-qstash-primary-v1";
export const QSTASH_PRIMARY_SCHEMA_ADVISORY_LOCK_KEY = "marketing_qstash_primary_schema_apply";

const MIGRATION_SQL_PATH = new URL(
  "../sql/marketing-dispatcher-qstash-primary.sql",
  import.meta.url,
);

const EXPECTED_SCHEMA = {
  marketing_dispatcher_qstash_primary: {
    columns: [
      { name: "id", dataType: "text", isNullable: "NO" },
      { name: "last_seen_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "updated_at", dataType: "timestamp with time zone", isNullable: "NO" },
    ],
    primaryKey: ["id"],
  },
  marketing_dispatcher_qstash_verified_deliveries: {
    columns: [
      { name: "jti", dataType: "text", isNullable: "NO" },
      { name: "seen_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "untrusted_message_id", dataType: "text", isNullable: "YES" },
    ],
    primaryKey: ["jti"],
    indexes: [
      {
        name: "marketing_dispatcher_qstash_verified_deliveries_seen_at_idx",
        column: "seen_at",
      },
    ],
  },
};

/**
 * @param {string} migrationSql
 * @returns {string[]}
 */
export function parseMarketingDispatcherQstashPrimaryMigrationStatements(migrationSql) {
  const statements = stripSqlLineComments(migrationSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 3) {
    throw new Error(
      `Expected 3 marketing dispatcher qstash primary migration statements, got ${statements.length}.`,
    );
  }

  const expectedPrefixes = [
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_primary",
    "CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries",
    "CREATE INDEX IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries_seen_at_idx",
  ];

  for (let i = 0; i < expectedPrefixes.length; i += 1) {
    const normalized = statements[i].replace(/\s+/g, " ");
    if (!normalized.startsWith(expectedPrefixes[i])) {
      throw new Error(
        `Statement ${i + 1} must start with "${expectedPrefixes[i]}".`,
      );
    }
  }

  return statements;
}

/**
 * @param {import("pg").PoolClient} client
 */
export async function verifyQstashPrimarySchemaCompatibility(client) {
  for (const [tableName, spec] of Object.entries(EXPECTED_SCHEMA)) {
    const columnsResult = await client.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName],
    );

    if (columnsResult.rows.length !== spec.columns.length) {
      throw qstashPrimarySchemaError("qstash_primary_schema_incompatible");
    }

    for (let i = 0; i < spec.columns.length; i += 1) {
      const expected = spec.columns[i];
      const actual = columnsResult.rows[i];
      if (
        actual.column_name !== expected.name ||
        actual.data_type !== expected.dataType ||
        actual.is_nullable !== expected.isNullable
      ) {
        throw qstashPrimarySchemaError("qstash_primary_schema_incompatible");
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
      throw qstashPrimarySchemaError("qstash_primary_schema_incompatible");
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
          throw qstashPrimarySchemaError("qstash_primary_schema_incompatible");
        }
        const indexdef = String(indexResult.rows[0].indexdef).toLowerCase();
        if (!indexdef.includes(`(${index.column})`)) {
          throw qstashPrimarySchemaError("qstash_primary_schema_incompatible");
        }
      }
    }
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string[]} statements
 */
export async function applyQstashPrimarySchemaStatementsInTransaction(client, statements) {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
      QSTASH_PRIMARY_SCHEMA_ADVISORY_LOCK_KEY,
    ]);
    for (const statement of statements) {
      await client.query(statement);
    }
    await verifyQstashPrimarySchemaCompatibility(client);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw qstashPrimarySchemaError("qstash_primary_schema_outcome_ambiguous", rollbackError);
    }
    if (error && typeof error === "object" && "code" in error && error.code) {
      throw error;
    }
    throw qstashPrimarySchemaError("qstash_primary_schema_apply_failed", error);
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function buildQstashPrimarySchemaDryRunReport(env = process.env) {
  const dryRun = env[QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]?.trim();
  if (dryRun && dryRun !== "report") {
    throw qstashPrimarySchemaError("qstash_primary_schema_dry_run_invalid");
  }

  const file = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const statements = parseMarketingDispatcherQstashPrimaryMigrationStatements(file);
  const presence = readQstashPrimarySchemaDryRunPresence(env);

  return {
    mode: "dry_run",
    migrationId: QSTASH_PRIMARY_SCHEMA_MIGRATION_ID,
    statementCount: statements.length,
    objects: [
      "marketing_dispatcher_qstash_primary",
      "marketing_dispatcher_qstash_verified_deliveries",
      "marketing_dispatcher_qstash_verified_deliveries_seen_at_idx",
    ],
    requiredExecuteVariables: [
      QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED,
      QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL,
      QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_HOST,
      QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_DATABASE,
    ],
    optionalDryRunVariable: QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN,
    configuration: presence,
    databaseConnection: false,
    sqlExecuted: false,
  };
}

/**
 * @param {string} connectionString
 * @param {string[]} statements
 */
export async function applyMarketingDispatcherQstashPrimarySchema(connectionString, statements) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await applyQstashPrimarySchemaStatementsInTransaction(client, statements);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export async function executeQstashPrimarySchemaMigration(env = process.env) {
  if (isQstashPrimarySchemaDryRunReport(env)) {
    return { dryRun: buildQstashPrimarySchemaDryRunReport(env) };
  }

  assertQstashPrimarySchemaApplyAuthorized(env);
  const target = resolveQstashPrimarySchemaDatabaseTarget(env);
  const file = readFileSync(MIGRATION_SQL_PATH, "utf8");
  const statements = parseMarketingDispatcherQstashPrimaryMigrationStatements(file);
  await applyMarketingDispatcherQstashPrimarySchema(target.connectionString, statements);

  return {
    ok: true,
    migrationId: QSTASH_PRIMARY_SCHEMA_MIGRATION_ID,
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
      : "qstash_primary_schema_apply_failed";
  console.error(code);
}

async function main() {
  const result = await executeQstashPrimarySchemaMigration(process.env);
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
