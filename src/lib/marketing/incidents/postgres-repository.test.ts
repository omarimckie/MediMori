import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { neon } from "@neondatabase/serverless";
import { Pool } from "@neondatabase/serverless";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";
import { resolveMarketingIncidentsTestDatabaseUrl } from "../../../../scripts/resolve-marketing-incidents-test-database-url.mjs";
import { IncidentValidationError } from "./validate";
import { recordIncident, resolveIncident, transitionIncidentStatus } from "./record";
import { createPostgresIncidentRepository } from "./postgres-repository";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../sql/marketing-incidents.sql", import.meta.url),
);

function resolveTestDbUrl(): string {
  const explicit = process.env.MARKETING_INCIDENTS_TEST_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return resolveMarketingIncidentsTestDatabaseUrl();
}

const testDbUrl = (() => {
  try {
    return resolveTestDbUrl();
  } catch {
    return "";
  }
})();

function baseInput(dedupeKey: string) {
  return {
    incidentType: "publication_failed",
    severity: "error",
    sourceOperation: "publish",
    dedupeKey,
    errorClass: "meta_http_error",
    errorMessage: "HTTP 503",
    retrySafety: "safe_manual",
    permittedActions: ["investigate_read_only"],
  };
}

async function applyIncidentsSchema(url: string) {
  const sql = neon(url);
  const file = readFileSync(migrationSqlPath, "utf8");
  const statements = parseMarketingIncidentsMigrationStatements(file);
  for (const statement of statements) {
    await sql.query(statement);
  }
}

async function assertIncidentsSchema(url: string) {
  const sql = neon(url);
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('marketing_incidents', 'marketing_incident_events')
    ORDER BY table_name
  `;
  assert.equal(tables.length, 2);
  const checks = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid IN (
      'marketing_incidents'::regclass,
      'marketing_incident_events'::regclass
    )
      AND contype = 'c'
  `;
  const names = new Set(
    checks.map((row) => String((row as Record<string, unknown>).conname)),
  );
  assert.ok(names.has("marketing_incidents_type_check"));
  assert.ok(names.has("marketing_incident_events_type_check"));
  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename IN ('marketing_incidents', 'marketing_incident_events')
  `;
  const indexNames = indexes.map((row) =>
    String((row as Record<string, unknown>).indexname),
  );
  assert.ok(indexNames.some((name) => name.includes("marketing_incidents_unresolved_status_idx")));
  assert.ok(
    indexNames.some((name) => name.includes("marketing_incident_events_incident_id_created_idx")),
  );
}

describe("postgres incident repository", { skip: !testDbUrl }, () => {
  before(async () => {
    process.env.DATABASE_URL = testDbUrl;
    await applyIncidentsSchema(testDbUrl);
    await assertIncidentsSchema(testDbUrl);
  });

  it("concurrent recordIncident yields one row and correct occurrence_count", async () => {
    process.env.DATABASE_URL = testDbUrl!;
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:concurrency:${crypto.randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 15 }, () => recordIncident(repo, baseInput(dedupeKey))),
    );
    const ids = new Set(results.map((r) => r.incident.id));
    assert.equal(ids.size, 1);
    const loaded = await repo.findByDedupeKey(dedupeKey);
    assert.equal(loaded?.occurrenceCount, 15);
    const events = await repo.listEvents(loaded!.id);
    const created = events.filter((e: { eventType: string }) => e.eventType === "incident_created").length;
    const occurrences = events.filter(
      (e: { eventType: string }) => e.eventType === "occurrence_recorded",
    ).length;
    assert.equal(created, 1);
    assert.equal(occurrences, 14);
    assert.equal(loaded?.incidentVersion, 15);
  });

  it("concurrent recurrence preserves first_seen_at and monotonic last_seen_at", async () => {
    process.env.DATABASE_URL = testDbUrl!;
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:timestamps:${crypto.randomUUID()}`;
    const firstSeen = "2026-01-01T12:00:00.000Z";
    const later = "2026-06-01T12:00:00.000Z";
    const earlier = "2025-06-01T12:00:00.000Z";
    await recordIncident(repo, {
      ...baseInput(dedupeKey),
      detectedAt: firstSeen,
      occurredAt: firstSeen,
    });
    await Promise.all([
      recordIncident(repo, { ...baseInput(dedupeKey), detectedAt: later }),
      recordIncident(repo, { ...baseInput(dedupeKey), detectedAt: earlier }),
    ]);
    const loaded = await repo.findByDedupeKey(dedupeKey);
    assert.equal(loaded?.occurrenceCount, 3);
    assert.equal(loaded?.firstSeenAt, firstSeen);
    assert.equal(loaded?.lastSeenAt, later);
  });

  it("status transition increments incident_version and appends status_changed event", async () => {
    process.env.DATABASE_URL = testDbUrl!;
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:transition:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, baseInput(dedupeKey));
    assert.equal(incident.incidentVersion, 1);
    const updated = await transitionIncidentStatus(repo, incident.id, "investigating");
    assert.equal(updated.incidentVersion, 2);
    const events = await repo.listEvents(incident.id);
    assert.ok(events.some((e) => e.eventType === "status_changed"));
  });

  it("transaction rolls back incident update when event insert violates CHECK", async () => {
    process.env.DATABASE_URL = testDbUrl!;
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:rollback:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, baseInput(dedupeKey));
    const pool = new Pool({ connectionString: testDbUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(
        `SELECT occurrence_count, incident_version FROM marketing_incidents WHERE id = $1::uuid`,
        [incident.id],
      );
      const beforeCount = Number(before.rows[0].occurrence_count);
      const beforeVersion = Number(before.rows[0].incident_version);
      await client.query(
        `UPDATE marketing_incidents
         SET occurrence_count = occurrence_count + 1, incident_version = incident_version + 1
         WHERE id = $1::uuid`,
        [incident.id],
      );
      await client.query(
        `INSERT INTO marketing_incident_events (id, incident_id, event_type, actor, payload)
         VALUES ($1::uuid, $2::uuid, $3, 'system', '{}'::jsonb)`,
        [crypto.randomUUID(), incident.id, "not_a_valid_event_type"],
      );
      await client.query("COMMIT");
      assert.fail("expected CHECK violation");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
    const after = await repo.findById(incident.id);
    assert.equal(after?.occurrenceCount, incident.occurrenceCount);
    assert.equal(after?.incidentVersion, incident.incidentVersion);
    const events = await repo.listEvents(incident.id);
    assert.equal(
      events.filter((e) => e.eventType === "occurrence_recorded").length,
      0,
    );
  });

  it("fail-closed parsePermittedActions on persisted read", async () => {
    process.env.DATABASE_URL = testDbUrl!;
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:bad-actions:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, baseInput(dedupeKey));
    const pool = new Pool({ connectionString: testDbUrl });
    await pool.query(
      `UPDATE marketing_incidents SET permitted_actions = $2::jsonb WHERE id = $1::uuid`,
      [incident.id, JSON.stringify(["definitely_not_a_permitted_action"])],
    );
    await pool.end();
    await assert.rejects(
      () => repo.findById(incident.id),
      (error: unknown) => error instanceof IncidentValidationError,
    );
  });

  it("resolved incident without reopenIfResolved throws and preserves row", async () => {
    process.env.DATABASE_URL = testDbUrl!;
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:resolved:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, baseInput(dedupeKey));
    const correlation = incident.agentWorkCorrelationId;
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "done",
    });
    await assert.rejects(() => recordIncident(repo, baseInput(dedupeKey)));
    const reopened = await recordIncident(repo, baseInput(dedupeKey), { reopenIfResolved: true });
    assert.equal(reopened.incident.agentWorkCorrelationId, correlation);
    assert.equal(reopened.outcome, "reopened");
  });
});
