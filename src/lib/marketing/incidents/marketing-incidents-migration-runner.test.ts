import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../sql/marketing-incidents.sql", import.meta.url),
);

describe("marketing incidents migration runner", () => {
  it("parses six statements in safe order", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingIncidentsMigrationStatements(file);
    assert.equal(statements.length, 6);
    assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS marketing_incidents/);
    assert.match(statements[0], /dedupe_key TEXT NOT NULL UNIQUE/);
    assert.match(statements[0], /agent_work_correlation_id UUID NOT NULL/);
    assert.match(statements[4], /^CREATE TABLE IF NOT EXISTS marketing_incident_events/);
    assert.match(statements[5], /marketing_incident_events_incident_id_created_idx/);
  });
});
