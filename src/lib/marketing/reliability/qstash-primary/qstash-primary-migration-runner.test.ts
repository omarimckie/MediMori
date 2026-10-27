import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseMarketingDispatcherQstashPrimaryMigrationStatements } from "../../../../../scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../../sql/marketing-dispatcher-qstash-primary.sql", import.meta.url),
);

describe("marketing dispatcher qstash primary migration runner", () => {
  it("parses three statements in dependency-safe order", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingDispatcherQstashPrimaryMigrationStatements(file);
    assert.equal(statements.length, 3);
    assert.match(
      statements[0],
      /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_primary/,
    );
    assert.match(
      statements[1],
      /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries/,
    );
    assert.match(
      statements[2],
      /^CREATE INDEX IF NOT EXISTS marketing_dispatcher_qstash_verified_deliveries_seen_at_idx/,
    );
  });
});
