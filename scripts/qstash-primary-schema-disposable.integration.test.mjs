import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  executeQstashPrimarySchemaMigration,
  verifyQstashPrimarySchemaCompatibility,
} from "./apply-marketing-dispatcher-qstash-primary-schema.mjs";
import { createDisposableWatchdogPgPool } from "./dispatcher-watchdog-disposable-postgres-pool.mjs";
import {
  DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE,
  isDispatcherWatchdogIntegrationConfigured,
  resolveMarketingDispatcherWatchdogTestDatabaseUrl,
} from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";
import { QSTASH_PRIMARY_SCHEMA_ENV } from "./resolve-marketing-qstash-primary-schema-database-url.mjs";

const integrationEnabled = isDispatcherWatchdogIntegrationConfigured();

const UNRELATED_TABLE = "h3_stage_b_unrelated_preserve";
const UNRELATED_ROW_ID = "h3_stage_b_unrelated_row_01";
const SYNTHETIC_DELIVERY_JTI = "h3_stage_b_synthetic_delivery_jti";
const INCOMPATIBLE_PRIMARY_ROW_ID = "h3_stage_b_incompatible_primary_row";

/** Independent catalog expectations derived from sql/marketing-dispatcher-qstash-primary.sql */
const H3_CATALOG_EXPECTATIONS = {
  marketing_dispatcher_qstash_primary: {
    columns: [
      { name: "id", dataType: "text", isNullable: "NO" },
      { name: "last_seen_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "updated_at", dataType: "timestamp with time zone", isNullable: "NO" },
    ],
    primaryKey: ["id"],
    idColumnDefault: "primary",
  },
  marketing_dispatcher_qstash_verified_deliveries: {
    columns: [
      { name: "jti", dataType: "text", isNullable: "NO" },
      { name: "seen_at", dataType: "timestamp with time zone", isNullable: "NO" },
      { name: "untrusted_message_id", dataType: "text", isNullable: "YES" },
    ],
    primaryKey: ["jti"],
    index: {
      name: "marketing_dispatcher_qstash_verified_deliveries_seen_at_idx",
      table: "marketing_dispatcher_qstash_verified_deliveries",
      column: "seen_at",
    },
  },
};

function buildMigrationEnv(connectionString) {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    [QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]: undefined,
    [QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    [QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL]: connectionString,
    [QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_HOST]: url.hostname,
    [QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_DATABASE]: databaseName,
  };
}

async function dropQstashPrimaryObjects(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DROP INDEX IF EXISTS marketing_dispatcher_qstash_verified_deliveries_seen_at_idx`,
    );
    await client.query(`DROP TABLE IF EXISTS marketing_dispatcher_qstash_verified_deliveries`);
    await client.query(`DROP TABLE IF EXISTS marketing_dispatcher_qstash_primary`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function dropUnrelatedPreserveFixture(pool) {
  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${UNRELATED_TABLE}`);
  } finally {
    client.release();
  }
}

async function setupUnrelatedPreserveFixture(pool) {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${UNRELATED_TABLE} (
         marker_id TEXT PRIMARY KEY,
         note TEXT NOT NULL
       )`,
    );
    await client.query(`DELETE FROM ${UNRELATED_TABLE} WHERE marker_id = $1`, [UNRELATED_ROW_ID]);
    await client.query(
      `INSERT INTO ${UNRELATED_TABLE} (marker_id, note) VALUES ($1, $2)`,
      [UNRELATED_ROW_ID, "h3_stage_b_unrelated_fixture_value"],
    );
  } finally {
    client.release();
  }
}

async function readUnrelatedPreserveRow(pool) {
  const result = await pool.query(
    `SELECT marker_id, note FROM ${UNRELATED_TABLE} WHERE marker_id = $1`,
    [UNRELATED_ROW_ID],
  );
  return result.rows[0] ?? null;
}

async function assertUnrelatedPreserveRowUnchanged(pool) {
  const row = await readUnrelatedPreserveRow(pool);
  assert.ok(row);
  assert.equal(row.marker_id, UNRELATED_ROW_ID);
  assert.equal(row.note, "h3_stage_b_unrelated_fixture_value");
}

async function listH3PublicObjectNames(pool) {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'marketing_dispatcher_qstash_primary',
         'marketing_dispatcher_qstash_verified_deliveries'
       )
     ORDER BY table_name`,
  );
  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'marketing_dispatcher_qstash_verified_deliveries_seen_at_idx'`,
  );
  return {
    tables: tables.rows.map((row) => row.table_name),
    indexCount: indexes.rowCount,
  };
}

async function assertH3CatalogMatchesSqlDefinition(pool) {
  for (const [tableName, spec] of Object.entries(H3_CATALOG_EXPECTATIONS)) {
    const columns = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName],
    );
    assert.equal(columns.rowCount, spec.columns.length, `column count for ${tableName}`);
    for (let i = 0; i < spec.columns.length; i += 1) {
      const expected = spec.columns[i];
      const actual = columns.rows[i];
      assert.equal(actual.column_name, expected.name);
      assert.equal(actual.data_type, expected.dataType);
      assert.equal(actual.is_nullable, expected.isNullable);
    }

    const pk = await pool.query(
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
    const pkColumns = pk.rows.map((row) => row.column_name);
    assert.deepEqual(pkColumns, spec.primaryKey);

    if (spec.idColumnDefault) {
      const defaultResult = await pool.query(
        `SELECT pg_get_expr(adbin, adrelid) AS column_default
         FROM pg_attrdef d
         JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = $1
           AND a.attname = 'id'`,
        [tableName],
      );
      assert.equal(defaultResult.rowCount, 1);
      const defaultExpr = String(defaultResult.rows[0].column_default).replace(/::text$/, "");
      assert.equal(defaultExpr, `'${spec.idColumnDefault}'`);
    }

    if (spec.index) {
      const indexResult = await pool.query(
        `SELECT indexname, tablename, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = $1`,
        [spec.index.name],
      );
      assert.equal(indexResult.rowCount, 1);
      assert.equal(indexResult.rows[0].tablename, spec.index.table);
      const indexdef = String(indexResult.rows[0].indexdef).toLowerCase();
      assert.ok(indexdef.includes(`(${spec.index.column})`));
    }
  }
}

async function assertNoIdleInTransactionBackends(pool) {
  const result = await pool.query(
    `SELECT pid FROM pg_stat_activity
     WHERE datname = current_database()
       AND state = 'idle in transaction'
       AND pid <> pg_backend_pid()`,
  );
  assert.equal(result.rowCount, 0, "unexpected idle in transaction backends");
}

async function countOtherDatabaseBackends(pool) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()`,
  );
  return result.rows[0].count;
}

describe("qstash primary schema disposable guards (offline)", () => {
  it("resolver fails closed without disposable allow token", () => {
    assert.throws(
      () => resolveMarketingDispatcherWatchdogTestDatabaseUrl({}),
      (error) => error.message === "dispatcher_watchdog_test_allow_missing_or_invalid",
    );
  });

  it("resolver requires the disposable-local-only allow value", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl({
          MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "not-disposable",
        }),
      (error) => error.message === "dispatcher_watchdog_test_allow_missing_or_invalid",
    );
  });

  it("integration enablement is false without explicit disposable env", () => {
    assert.equal(isDispatcherWatchdogIntegrationConfigured({}), false);
  });

  it("documented disposable allow constant matches resolver contract", () => {
    assert.equal(DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE, "disposable-local-only");
  });
});

describe(
  "qstash primary schema disposable integration (H3)",
  { skip: !integrationEnabled },
  () => {
    let pool;
    let migrationEnv;

    before(async () => {
      const connectionString = resolveMarketingDispatcherWatchdogTestDatabaseUrl();
      pool = createDisposableWatchdogPgPool(connectionString);
      migrationEnv = buildMigrationEnv(connectionString);
    });

    beforeEach(async () => {
      await dropQstashPrimaryObjects(pool);
      await dropUnrelatedPreserveFixture(pool);
    });

    after(async () => {
      try {
        await dropUnrelatedPreserveFixture(pool);
        await dropQstashPrimaryObjects(pool);
      } finally {
        await pool.end();
      }
    });

    it("successful guarded schema apply creates tables and index", async () => {
      const backendsBefore = await countOtherDatabaseBackends(pool);
      const result = await executeQstashPrimarySchemaMigration(migrationEnv);
      assert.equal(result.ok, true);
      assert.equal(result.transactionCommitted, true);
      assert.equal(result.schemaVerificationPassed, true);

      const objects = await listH3PublicObjectNames(pool);
      assert.deepEqual(objects.tables, [
        "marketing_dispatcher_qstash_primary",
        "marketing_dispatcher_qstash_verified_deliveries",
      ]);
      assert.equal(objects.indexCount, 1);

      await assertH3CatalogMatchesSqlDefinition(pool);

      const verifierClient = await pool.connect();
      try {
        await verifyQstashPrimarySchemaCompatibility(verifierClient);
      } finally {
        verifierClient.release();
      }

      const backendsAfter = await countOtherDatabaseBackends(pool);
      assert.equal(backendsAfter, backendsBefore);
      await assertNoIdleInTransactionBackends(pool);
    });

    it("idempotent second apply preserves compatible schema and synthetic row values", async () => {
      await setupUnrelatedPreserveFixture(pool);

      const first = await executeQstashPrimarySchemaMigration(migrationEnv);
      assert.equal(first.ok, true);

      const insertClient = await pool.connect();
      let seenAtBefore;
      try {
        const inserted = await insertClient.query(
          `INSERT INTO marketing_dispatcher_qstash_verified_deliveries (jti, untrusted_message_id)
           VALUES ($1, $2)
           RETURNING jti, seen_at, untrusted_message_id`,
          [SYNTHETIC_DELIVERY_JTI, "h3_stage_b_synthetic_untrusted_id"],
        );
        seenAtBefore = inserted.rows[0].seen_at;
      } finally {
        insertClient.release();
      }

      const second = await executeQstashPrimarySchemaMigration(migrationEnv);
      assert.equal(second.ok, true);
      assert.equal(second.transactionCommitted, true);

      const preserved = await pool.query(
        `SELECT jti, seen_at, untrusted_message_id
         FROM marketing_dispatcher_qstash_verified_deliveries
         WHERE jti = $1`,
        [SYNTHETIC_DELIVERY_JTI],
      );
      assert.equal(preserved.rowCount, 1);
      assert.equal(preserved.rows[0].jti, SYNTHETIC_DELIVERY_JTI);
      assert.equal(String(preserved.rows[0].seen_at), String(seenAtBefore));
      assert.equal(preserved.rows[0].untrusted_message_id, "h3_stage_b_synthetic_untrusted_id");

      await assertH3CatalogMatchesSqlDefinition(pool);

      const objects = await listH3PublicObjectNames(pool);
      assert.equal(objects.tables.length, 2);
      assert.equal(objects.indexCount, 1);

      await assertUnrelatedPreserveRowUnchanged(pool);
      await assertNoIdleInTransactionBackends(pool);
    });

    it("incompatible existing table is rejected without destructive repair", async () => {
      await setupUnrelatedPreserveFixture(pool);

      const client = await pool.connect();
      try {
        await client.query(
          `CREATE TABLE marketing_dispatcher_qstash_primary (
             id TEXT PRIMARY KEY,
             last_seen_at TIMESTAMPTZ NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO marketing_dispatcher_qstash_primary (id, last_seen_at)
           VALUES ($1, now())`,
          [INCOMPATIBLE_PRIMARY_ROW_ID],
        );
      } finally {
        client.release();
      }

      const backendsBefore = await countOtherDatabaseBackends(pool);
      await assert.rejects(
        () => executeQstashPrimarySchemaMigration(migrationEnv),
        (error) => error.code === "qstash_primary_schema_incompatible",
      );

      const incompatibleRow = await pool.query(
        `SELECT id FROM marketing_dispatcher_qstash_primary WHERE id = $1`,
        [INCOMPATIBLE_PRIMARY_ROW_ID],
      );
      assert.equal(incompatibleRow.rowCount, 1);

      const objects = await listH3PublicObjectNames(pool);
      assert.deepEqual(objects.tables, ["marketing_dispatcher_qstash_primary"]);
      assert.equal(objects.indexCount, 0);

      const verifiedDeliveriesExists = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'marketing_dispatcher_qstash_verified_deliveries'`,
      );
      assert.equal(verifiedDeliveriesExists.rowCount, 0);

      await assertUnrelatedPreserveRowUnchanged(pool);

      const backendsAfter = await countOtherDatabaseBackends(pool);
      assert.equal(backendsAfter, backendsBefore);
      await assertNoIdleInTransactionBackends(pool);
    });

    it("third DDL failure rolls back newly created H3 objects", async () => {
      await setupUnrelatedPreserveFixture(pool);

      const fixtureClient = await pool.connect();
      const fixtureJti = "h3_stage_b_preexisting_verified_fixture_jti";
      try {
        await fixtureClient.query(
          `CREATE TABLE marketing_dispatcher_qstash_verified_deliveries (
             jti TEXT PRIMARY KEY
           )`,
        );
        await fixtureClient.query(
          `INSERT INTO marketing_dispatcher_qstash_verified_deliveries (jti) VALUES ($1)`,
          [fixtureJti],
        );
      } finally {
        fixtureClient.release();
      }

      const backendsBefore = await countOtherDatabaseBackends(pool);
      await assert.rejects(
        () => executeQstashPrimarySchemaMigration(migrationEnv),
        (error) => {
          assert.equal(error?.code, "42703");
          return true;
        },
      );

      const primaryExists = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'marketing_dispatcher_qstash_primary'`,
      );
      assert.equal(primaryExists.rowCount, 0);

      const preexisting = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'marketing_dispatcher_qstash_verified_deliveries'
         ORDER BY ordinal_position`,
      );
      assert.deepEqual(preexisting.rows.map((row) => row.column_name), ["jti"]);

      const preservedFixtureRow = await pool.query(
        `SELECT jti FROM marketing_dispatcher_qstash_verified_deliveries WHERE jti = $1`,
        [fixtureJti],
      );
      assert.equal(preservedFixtureRow.rowCount, 1);

      const objects = await listH3PublicObjectNames(pool);
      assert.deepEqual(objects.tables, ["marketing_dispatcher_qstash_verified_deliveries"]);
      assert.equal(objects.indexCount, 0);

      await assertUnrelatedPreserveRowUnchanged(pool);

      const backendsAfter = await countOtherDatabaseBackends(pool);
      assert.equal(backendsAfter, backendsBefore);
      await assertNoIdleInTransactionBackends(pool);
    });

    it("unrelated preserve fixture survives successful migration and reapplication", async () => {
      await setupUnrelatedPreserveFixture(pool);

      const first = await executeQstashPrimarySchemaMigration(migrationEnv);
      assert.equal(first.ok, true);
      await assertUnrelatedPreserveRowUnchanged(pool);

      const second = await executeQstashPrimarySchemaMigration(migrationEnv);
      assert.equal(second.ok, true);
      await assertUnrelatedPreserveRowUnchanged(pool);
    });

    it("concurrent guarded migrations preserve compatible schema", async () => {
      const backendsBefore = await countOtherDatabaseBackends(pool);

      const [first, second] = await Promise.all([
        executeQstashPrimarySchemaMigration(migrationEnv),
        executeQstashPrimarySchemaMigration(migrationEnv),
      ]);

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(first.transactionCommitted, true);
      assert.equal(second.transactionCommitted, true);

      await assertH3CatalogMatchesSqlDefinition(pool);
      const objects = await listH3PublicObjectNames(pool);
      assert.equal(objects.tables.length, 2);
      assert.equal(objects.indexCount, 1);

      const backendsAfter = await countOtherDatabaseBackends(pool);
      assert.equal(backendsAfter, backendsBefore);
      await assertNoIdleInTransactionBackends(pool);
    });
  },
);
