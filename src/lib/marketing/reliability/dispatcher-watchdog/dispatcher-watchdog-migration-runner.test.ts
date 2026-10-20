import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseMarketingDispatcherWatchdogMigrationStatements } from "../../../../../scripts/apply-marketing-dispatcher-watchdog-schema.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../../sql/marketing-dispatcher-watchdog.sql", import.meta.url),
);

describe("marketing dispatcher watchdog migration runner", () => {
  it("parses six statements in dependency-safe order", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingDispatcherWatchdogMigrationStatements(file);
    assert.equal(statements.length, 7);
    assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_state/);
    assert.match(
      statements[1],
      /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_observations/,
    );
    assert.match(
      statements[2],
      /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_watchdog_incident_notifications/,
    );
    assert.match(
      statements[3],
      /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_maintenance_windows/,
    );
    assert.match(
      statements[4],
      /^CREATE INDEX IF NOT EXISTS marketing_dispatcher_maintenance_ends_at_idx/,
    );
    assert.match(
      statements[6],
      /^ALTER TABLE marketing_dispatcher_watchdog_incident_notifications/,
    );
    assert.doesNotMatch(file, /WHERE\s+ends_at\s*>\s*now\s*\(\s*\)/i);
  });
});
