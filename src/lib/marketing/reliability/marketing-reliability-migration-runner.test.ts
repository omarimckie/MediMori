import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseMarketingReliabilityMigrationStatements } from "../../../../scripts/apply-marketing-reliability-schema.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../sql/marketing-reliability.sql", import.meta.url),
);

describe("marketing reliability migration runner", () => {
  it("parses three statements in safe order", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingReliabilityMigrationStatements(file);
    assert.equal(statements.length, 3);
    assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS marketing_dispatcher_heartbeats/);
    assert.match(statements[1], /^CREATE TABLE IF NOT EXISTS marketing_reliability_dedup/);
    assert.match(statements[2], /^CREATE INDEX IF NOT EXISTS marketing_reliability_dedup_publication_idx/);
  });
});
