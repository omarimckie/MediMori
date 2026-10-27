import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  MARKETING_INCIDENT_EVENT_TYPES,
  MARKETING_INCIDENT_STATUSES,
  MARKETING_INCIDENT_SEVERITIES,
  MARKETING_INCIDENT_TYPES,
  RESOLUTION_TYPES,
  RETRY_SAFETY_VALUES,
} from "./types";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../sql/marketing-incidents.sql", import.meta.url),
);

function sqlListsValues(sql: string, constraintName: string): string[] {
  const pattern = new RegExp(
    `CONSTRAINT ${constraintName} CHECK \\([\\s\\S]*?IN \\(([\\s\\S]*?)\\)\\s*\\)`,
    "i",
  );
  const match = sql.match(pattern);
  assert.ok(match, `missing constraint ${constraintName}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("marketing incidents schema / TS consistency", () => {
  const sql = readFileSync(migrationSqlPath, "utf8");

  it("incident_type CHECK matches MARKETING_INCIDENT_TYPES", () => {
    const dbValues = sqlListsValues(sql, "marketing_incidents_type_check");
    assert.deepEqual([...MARKETING_INCIDENT_TYPES].sort(), [...dbValues].sort());
  });

  it("status CHECK matches MARKETING_INCIDENT_STATUSES", () => {
    const dbValues = sqlListsValues(sql, "marketing_incidents_status_check");
    assert.deepEqual([...MARKETING_INCIDENT_STATUSES].sort(), [...dbValues].sort());
  });

  it("severity CHECK matches MARKETING_INCIDENT_SEVERITIES", () => {
    const dbValues = sqlListsValues(sql, "marketing_incidents_severity_check");
    assert.deepEqual([...MARKETING_INCIDENT_SEVERITIES].sort(), [...dbValues].sort());
  });

  it("retry_safety CHECK matches RETRY_SAFETY_VALUES", () => {
    const dbValues = sqlListsValues(sql, "marketing_incidents_retry_safety_check");
    assert.deepEqual([...RETRY_SAFETY_VALUES].sort(), [...dbValues].sort());
  });

  it("resolution_type CHECK matches RESOLUTION_TYPES", () => {
    const block = sql.match(/marketing_incidents_resolution_type_check[\s\S]*?\)/i)?.[0] ?? "";
    const dbValues = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...RESOLUTION_TYPES].sort(), [...dbValues].sort());
  });

  it("event_type CHECK matches MARKETING_INCIDENT_EVENT_TYPES", () => {
    const dbValues = sqlListsValues(sql, "marketing_incident_events_type_check");
    assert.deepEqual([...MARKETING_INCIDENT_EVENT_TYPES].sort(), [...dbValues].sort());
  });
});
