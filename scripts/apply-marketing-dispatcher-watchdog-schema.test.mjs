import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyDispatcherWatchdogSchemaStatementsInTransaction,
  buildDispatcherWatchdogSchemaDryRunReport,
  executeDispatcherWatchdogSchemaMigration,
  parseMarketingDispatcherWatchdogMigrationStatements,
  verifyDispatcherWatchdogSchemaCompatibility,
} from "./apply-marketing-dispatcher-watchdog-schema.mjs";
import {
  assertDispatcherWatchdogSchemaApplyAuthorized,
  DISPATCHER_WATCHDOG_SCHEMA_ENV,
  isDispatcherWatchdogSchemaDryRunReport,
  resolveDispatcherWatchdogSchemaDatabaseTarget,
} from "./resolve-marketing-dispatcher-watchdog-schema-database-url.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../sql/marketing-dispatcher-watchdog.sql", import.meta.url),
);
const applyScriptPath = fileURLToPath(
  new URL("./apply-marketing-dispatcher-watchdog-schema.mjs", import.meta.url),
);

function baseTargetEnv(overrides = {}) {
  return {
    [DISPATCHER_WATCHDOG_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    [DISPATCHER_WATCHDOG_SCHEMA_ENV.DATABASE_URL]:
      "postgresql://migration_user:secret@tf-watchdog-pg-run1.example/marketing_watchdog",
    [DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_HOST]: "tf-watchdog-pg-run1.example",
    [DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_DATABASE]: "marketing_watchdog",
    ...overrides,
  };
}

describe("dispatcher watchdog schema migration guards", () => {
  it("missing authorization fails closed", () => {
    assert.throws(
      () => assertDispatcherWatchdogSchemaApplyAuthorized({}),
      (error) => error.code === "dispatcher_watchdog_schema_not_authorized",
    );
  });

  it("DATABASE_URL alone is ignored", () => {
    assert.throws(
      () =>
        resolveDispatcherWatchdogSchemaDatabaseTarget({
          DATABASE_URL: "postgresql://app:secret@prod.example/appdb",
        }),
      (error) => error.code === "dispatcher_watchdog_schema_url_missing",
    );
  });

  it("apply script does not reference .env.local", () => {
    const source = readFileSync(applyScriptPath, "utf8");
    assert.doesNotMatch(source, /\.env\.local/);
    assert.doesNotMatch(source, /loadDatabaseUrl/);
    assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
  });

  it("host mismatch fails closed", () => {
    assert.throws(
      () =>
        resolveDispatcherWatchdogSchemaDatabaseTarget({
          ...baseTargetEnv(),
          [DISPATCHER_WATCHDOG_SCHEMA_ENV.EXPECTED_HOST]: "wrong-host.example",
        }),
      (error) => error.code === "dispatcher_watchdog_schema_target_mismatch",
    );
  });

  it("dry-run without authorization", () => {
    const report = buildDispatcherWatchdogSchemaDryRunReport({
      [DISPATCHER_WATCHDOG_SCHEMA_ENV.DRY_RUN]: "report",
    });
    assert.equal(report.mode, "dry_run");
    assert.equal(report.statementCount, 7);
    assert.deepEqual(report.prerequisiteTables, ["marketing_incidents"]);
    assert.equal(report.databaseConnection, false);
  });

  it("dry-run execute path never connects", async () => {
    const result = await executeDispatcherWatchdogSchemaMigration({
      [DISPATCHER_WATCHDOG_SCHEMA_ENV.DRY_RUN]: "report",
      [DISPATCHER_WATCHDOG_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    });
    assert.ok(result.dryRun);
    assert.equal(result.dryRun.sqlExecuted, false);
  });

  it("parser returns exactly seven statements", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingDispatcherWatchdogMigrationStatements(file);
    assert.equal(statements.length, 7);
  });

  it("transaction rolls back on DDL failure", async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(String(sql));
        if (String(sql).includes("CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_starts_at_idx")) {
          throw new Error("forced_failure");
        }
        if (String(sql).includes("information_schema.tables")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await assert.rejects(
      () =>
        applyDispatcherWatchdogSchemaStatementsInTransaction(client, [
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_state (id text)",
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_observations (observation_slot_id bigint)",
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_incident_notifications (incident_id uuid)",
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_maintenance_windows (id uuid)",
          "CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_ends_at_idx ON marketing_dispatcher_maintenance_windows (ends_at)",
          "CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_starts_at_idx ON marketing_dispatcher_maintenance_windows (starts_at)",
          "ALTER TABLE marketing_dispatcher_watchdog_incident_notifications ADD COLUMN IF NOT EXISTS outage_push_claim_nonce UUID",
        ]),
      (error) => error.code === "dispatcher_watchdog_schema_apply_failed",
    );

    assert.equal(calls[0], "BEGIN");
    assert.ok(calls.includes("ROLLBACK"));
    assert.equal(calls.filter((sql) => sql === "COMMIT").length, 0);
  });

  it("missing marketing_incidents prerequisite fails closed", async () => {
    const client = {
      query: async (sql) => {
        if (String(sql).includes("information_schema.tables")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await assert.rejects(
      () =>
        applyDispatcherWatchdogSchemaStatementsInTransaction(client, [
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_state (id text)",
        ]),
      (error) => error.code === "dispatcher_watchdog_schema_prerequisite_missing",
    );
  });

  it("schema incompatibility classification", async () => {
    const client = {
      query: async (sql) => {
        if (String(sql).includes("information_schema.columns")) {
          return {
            rows: [{ column_name: "wrong", data_type: "text", is_nullable: "NO" }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await assert.rejects(
      () => verifyDispatcherWatchdogSchemaCompatibility(client),
      (error) => error.code === "dispatcher_watchdog_schema_incompatible",
    );
  });

  it("dry-run mode is detected", () => {
    assert.equal(
      isDispatcherWatchdogSchemaDryRunReport({
        [DISPATCHER_WATCHDOG_SCHEMA_ENV.DRY_RUN]: "report",
      }),
      true,
    );
  });
});
