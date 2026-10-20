import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyQstashPrimarySchemaStatementsInTransaction,
  buildQstashPrimarySchemaDryRunReport,
  executeQstashPrimarySchemaMigration,
  parseMarketingDispatcherQstashPrimaryMigrationStatements,
  verifyQstashPrimarySchemaCompatibility,
} from "./apply-marketing-dispatcher-qstash-primary-schema.mjs";
import {
  assertQstashPrimarySchemaApplyAuthorized,
  isQstashPrimarySchemaDryRunReport,
  QSTASH_PRIMARY_SCHEMA_ENV,
  resolveQstashPrimarySchemaDatabaseTarget,
} from "./resolve-marketing-qstash-primary-schema-database-url.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../sql/marketing-dispatcher-qstash-primary.sql", import.meta.url),
);
const applyScriptPath = fileURLToPath(
  new URL("./apply-marketing-dispatcher-qstash-primary-schema.mjs", import.meta.url),
);

function baseTargetEnv(overrides = {}) {
  return {
    [QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    [QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL]:
      "postgresql://migration_user:secret@tf-watchdog-pg-run1.example/marketing_qstash",
    [QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_HOST]: "tf-watchdog-pg-run1.example",
    [QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_DATABASE]: "marketing_qstash",
    ...overrides,
  };
}

describe("qstash primary schema migration guards", () => {
  it("missing authorization fails closed", () => {
    assert.throws(
      () => assertQstashPrimarySchemaApplyAuthorized({}),
      (error) => error.code === "qstash_primary_schema_not_authorized",
    );
  });

  it("incorrect authorization fails closed", () => {
    assert.throws(
      () =>
        assertQstashPrimarySchemaApplyAuthorized({
          [QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]: "yes",
        }),
      (error) => error.code === "qstash_primary_schema_not_authorized",
    );
  });

  it("correct authorization passes", () => {
    assertQstashPrimarySchemaApplyAuthorized({
      [QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    });
  });

  it("missing dedicated URL fails before connect", () => {
    assert.throws(
      () =>
        resolveQstashPrimarySchemaDatabaseTarget({
          ...baseTargetEnv(),
          [QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL]: "",
        }),
      (error) => error.code === "qstash_primary_schema_url_missing",
    );
  });

  it("malformed URL fails closed", () => {
    assert.throws(
      () =>
        resolveQstashPrimarySchemaDatabaseTarget({
          ...baseTargetEnv(),
          [QSTASH_PRIMARY_SCHEMA_ENV.DATABASE_URL]: "not-a-url",
        }),
      (error) => error.code === "qstash_primary_schema_url_invalid",
    );
  });

  it("DATABASE_URL alone is ignored", () => {
    assert.throws(
      () =>
        resolveQstashPrimarySchemaDatabaseTarget({
          DATABASE_URL: "postgresql://app:secret@prod.example/appdb",
        }),
      (error) => error.code === "qstash_primary_schema_url_missing",
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
        resolveQstashPrimarySchemaDatabaseTarget({
          ...baseTargetEnv(),
          [QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_HOST]: "wrong-host.example",
        }),
      (error) => error.code === "qstash_primary_schema_target_mismatch",
    );
  });

  it("database mismatch fails closed", () => {
    assert.throws(
      () =>
        resolveQstashPrimarySchemaDatabaseTarget({
          ...baseTargetEnv(),
          [QSTASH_PRIMARY_SCHEMA_ENV.EXPECTED_DATABASE]: "other_db",
        }),
      (error) => error.code === "qstash_primary_schema_target_mismatch",
    );
  });

  it("valid explicit target resolves host and database", () => {
    const target = resolveQstashPrimarySchemaDatabaseTarget(baseTargetEnv());
    assert.equal(target.hostname, "tf-watchdog-pg-run1.example");
    assert.equal(target.databaseName, "marketing_qstash");
    assert.match(target.connectionString, /^postgresql:\/\//);
  });

  it("dry-run without authorization", () => {
    const report = buildQstashPrimarySchemaDryRunReport({
      [QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]: "report",
    });
    assert.equal(report.mode, "dry_run");
    assert.equal(report.statementCount, 3);
    assert.equal(report.databaseConnection, false);
    assert.equal(report.configuration.executeAuthorizationPresent, false);
  });

  it("dry-run with execute authorization present does not require auth", () => {
    const report = buildQstashPrimarySchemaDryRunReport({
      [QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]: "report",
      [QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    });
    assert.equal(report.configuration.executeAuthorizationPresent, true);
    assert.equal(report.databaseConnection, false);
  });

  it("invalid dry-run value fails closed", () => {
    assert.throws(
      () =>
        buildQstashPrimarySchemaDryRunReport({
          [QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]: "preview",
        }),
      (error) => error.code === "qstash_primary_schema_dry_run_invalid",
    );
  });

  it("dry-run execute path never connects", async () => {
    const result = await executeQstashPrimarySchemaMigration({
      [QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]: "report",
      [QSTASH_PRIMARY_SCHEMA_ENV.APPLY_AUTHORIZED]: "execute",
    });
    assert.ok(result.dryRun);
    assert.equal(result.dryRun.sqlExecuted, false);
  });

  it("parser returns exactly three statements", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingDispatcherQstashPrimaryMigrationStatements(file);
    assert.equal(statements.length, 3);
  });

  it("parser rejects unexpected SQL", () => {
    assert.throws(() =>
      parseMarketingDispatcherQstashPrimaryMigrationStatements(
        "CREATE TABLE foo (id int);\nCREATE TABLE bar (id int);\n",
      ),
    );
  });

  it("transaction begins before DDL and rolls back on failure", async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(String(sql));
        if (String(sql).includes("CREATE INDEX")) {
          throw new Error("forced_failure");
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await assert.rejects(
      () =>
        applyQstashPrimarySchemaStatementsInTransaction(client, [
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_primary (id text)",
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries (jti text)",
          "CREATE INDEX IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries_seen_at_idx ON marketing_dispatcher_qstash_verified_deliveries (seen_at)",
        ]),
      (error) => error.code === "qstash_primary_schema_apply_failed",
    );

    assert.equal(calls[0], "BEGIN");
    assert.ok(calls.includes("ROLLBACK"));
    assert.equal(calls.filter((sql) => sql === "COMMIT").length, 0);
  });

  it("schema verification occurs before commit", async () => {
    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push(String(sql));
        if (String(sql).includes("information_schema.columns")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await assert.rejects(
      () =>
        applyQstashPrimarySchemaStatementsInTransaction(client, [
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_primary (id text)",
          "CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries (jti text)",
          "CREATE INDEX IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries_seen_at_idx ON marketing_dispatcher_qstash_verified_deliveries (seen_at)",
        ]),
      (error) => error.code === "qstash_primary_schema_incompatible",
    );

    const commitIndex = calls.indexOf("COMMIT");
    assert.equal(commitIndex, -1);
    assert.ok(calls.some((sql) => sql.includes("information_schema.columns")));
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
      () => verifyQstashPrimarySchemaCompatibility(client),
      (error) => error.code === "qstash_primary_schema_incompatible",
    );
  });

  it("dry-run mode is detected", () => {
    assert.equal(
      isQstashPrimarySchemaDryRunReport({
        [QSTASH_PRIMARY_SCHEMA_ENV.DRY_RUN]: "report",
      }),
      true,
    );
  });
});
