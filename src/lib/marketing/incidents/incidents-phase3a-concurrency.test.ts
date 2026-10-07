import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it, test } from "node:test";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";
import { resolveMarketingIncidentsTestDatabaseUrl } from "../../../../scripts/resolve-marketing-incidents-test-database-url.mjs";
import { neon } from "@neondatabase/serverless";
import { IncidentVersionConflictError } from "./errors";
import { createPostgresIncidentRepository } from "./postgres-repository";
import {
  recordIncident,
  resolveIncident,
  transitionIncidentStatus,
} from "./record";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../sql/marketing-incidents.sql", import.meta.url),
);

function resolveTestDbUrl(): string {
  const explicit = process.env.MARKETING_INCIDENTS_TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  try {
    return resolveMarketingIncidentsTestDatabaseUrl();
  } catch {
    return "";
  }
}

const testDbUrl = resolveTestDbUrl();

function ambiguousPhase2Input(dedupeKey: string) {
  return {
    incidentType: "publication_ambiguous",
    status: "action_required",
    severity: "error",
    sourceOperation: "phase3a_concurrency_test",
    dedupeKey,
    errorClass: "meta_http_error",
    errorMessage: "timeout",
    retrySafety: "unknown_requires_verification",
    permittedActions: ["investigate_read_only", "owner_approve_remediation"],
    humanApprovalRequired: true,
    publicationId: "00000000-0000-4000-8000-000000000001",
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

function assertEnvelopeUnchanged(
  before: { retrySafety: string; permittedActions: readonly string[] },
  after: { retrySafety: string; permittedActions: readonly string[] },
) {
  assert.equal(after.retrySafety, before.retrySafety);
  assert.deepEqual(after.permittedActions, before.permittedActions);
}

test("postgres updateIncident enforces incident_version in SQL WHERE clause", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./postgres-repository.ts", import.meta.url)),
    "utf8",
  );
  assert.match(src, /WHERE id = \$1::uuid AND incident_version = \$2/);
});

describe("Phase III-A Postgres lifecycle concurrency", { skip: !testDbUrl }, () => {
  before(async () => {
    process.env.DATABASE_URL = testDbUrl;
    await applyIncidentsSchema(testDbUrl);
  });

  it("concurrent transition writers: one succeeds, one version conflict", async () => {
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:tx-transition-race:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, ambiguousPhase2Input(dedupeKey));
    const version = incident.incidentVersion;

    const results = await Promise.allSettled([
      transitionIncidentStatus(repo, incident.id, "investigating", "admin-a", version),
      transitionIncidentStatus(repo, incident.id, "blocked", "admin-b", version),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected.every(
        (r) =>
          r.status === "rejected" &&
          r.reason instanceof IncidentVersionConflictError,
      ),
    );

    const final = await repo.findById(incident.id);
    assert.ok(final);
    assert.equal(final.incidentVersion, version + 1);
    assert.ok(final.status === "investigating" || final.status === "blocked");
    const events = await repo.listEvents(incident.id);
    assert.equal(
      events.filter((e) => e.eventType === "status_changed").length,
      1,
    );
  });

  it("concurrent resolve writers: one succeeds, one version conflict", async () => {
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:tx-resolve-race:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, ambiguousPhase2Input(dedupeKey));
    const version = incident.incidentVersion;

    const results = await Promise.allSettled([
      resolveIncident(repo, incident.id, {
        resolutionType: "owner_resolved",
        resolutionSummary: "resolved by admin A",
        incidentVersion: version,
        actor: "admin-a",
      }),
      resolveIncident(repo, incident.id, {
        resolutionType: "owner_resolved",
        resolutionSummary: "resolved by admin B",
        incidentVersion: version,
        actor: "admin-b",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const final = await repo.findById(incident.id);
    assert.ok(final);
    assert.equal(final.status, "resolved");
    assert.equal(final.incidentVersion, version + 1);
    assert.equal(
      eventsCount(await repo.listEvents(incident.id), "incident_resolved"),
      1,
    );
  });

  it("recurrence vs resolution on open incident: single row, stable correlation, allowed final states", async () => {
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:recur-vs-resolve:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, ambiguousPhase2Input(dedupeKey));
    const envelope = {
      retrySafety: incident.retrySafety,
      permittedActions: incident.permittedActions,
    };
    const correlation = incident.agentWorkCorrelationId;
    const version = incident.incidentVersion;

    const results = await Promise.allSettled([
      resolveIncident(repo, incident.id, {
        resolutionType: "owner_resolved",
        resolutionSummary: "owner closed",
        incidentVersion: version,
      }),
      recordIncident(repo, ambiguousPhase2Input(dedupeKey)),
    ]);

    const byDedupe = await repo.findByDedupeKey(dedupeKey);
    assert.ok(byDedupe);
    assert.equal(byDedupe.id, incident.id);
    assert.equal(byDedupe.agentWorkCorrelationId, correlation);
    assertEnvelopeUnchanged(envelope, byDedupe);

    const allRows = await countIncidentRowsByDedupe(dedupeKey);
    assert.equal(allRows, 1);

    const resolvedWon = results[0].status === "fulfilled";
    const recurrenceWon = results[1].status === "fulfilled";

    assert.ok(resolvedWon || recurrenceWon);
    assert.ok(!(resolvedWon && recurrenceWon));

    const events = await repo.listEvents(incident.id);
    assert.equal(events.filter((e) => e.eventType === "incident_created").length, 1);

    if (resolvedWon) {
      assert.equal(byDedupe.status, "resolved");
      assert.equal(byDedupe.occurrenceCount, 1);
      assert.ok(byDedupe.resolutionSummary);
      assert.equal(eventsCount(events, "incident_resolved"), 1);
      assert.equal(eventsCount(events, "occurrence_recorded"), 0);
    } else {
      assert.notEqual(byDedupe.status, "resolved");
      assert.equal(byDedupe.occurrenceCount, 2);
      assert.equal(byDedupe.resolutionType, null);
      assert.equal(eventsCount(events, "occurrence_recorded"), 1);
      assert.equal(eventsCount(events, "incident_resolved"), 0);
      if (results[0].status === "rejected") {
        assert.ok(results[0].reason instanceof IncidentVersionConflictError);
      }
    }
  });

  it("reopen vs in-flight resolve: no duplicate rows, correlation stable, allowed outcomes", async () => {
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:reopen-vs-resolve:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, ambiguousPhase2Input(dedupeKey));
    const envelope = {
      retrySafety: incident.retrySafety,
      permittedActions: incident.permittedActions,
    };
    const correlation = incident.agentWorkCorrelationId;

    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "first close",
      incidentVersion: incident.incidentVersion,
    });
    const resolved = await repo.findById(incident.id);
    assert.ok(resolved);
    assert.equal(resolved.status, "resolved");
    const resolvedVersion = resolved.incidentVersion;

    const results = await Promise.allSettled([
      resolveIncident(repo, incident.id, {
        resolutionType: "owner_resolved",
        resolutionSummary: "stale resolve",
        incidentVersion: resolvedVersion - 1,
      }),
      recordIncident(repo, ambiguousPhase2Input(dedupeKey), { reopenIfResolved: true }),
    ]);

    const final = await loadByDedupeOrId(repo, dedupeKey, incident.id);
    assert.ok(final);
    assert.equal(final.id, incident.id);
    assert.equal(final.agentWorkCorrelationId, correlation);
    assertEnvelopeUnchanged(envelope, final);
    assert.equal(await countIncidentRowsByDedupe(dedupeKey), 1);

    const reopenWon = results[1].status === "fulfilled";
    const staleResolveRejected =
      results[0].status === "rejected" &&
      results[0].reason instanceof IncidentVersionConflictError;

    if (reopenWon) {
      assert.equal(final.status, "open");
      assert.equal(final.occurrenceCount, resolved.occurrenceCount + 1);
      assert.equal(final.resolutionType, null);
      assert.equal(final.resolvedAt, null);
      const events = await repo.listEvents(incident.id);
      assert.ok(events.some((e) => e.eventType === "incident_reopened"));
      assert.ok(events.some((e) => e.eventType === "occurrence_recorded"));
    } else {
      assert.equal(final.status, "resolved");
      assert.ok(staleResolveRejected || results[0].status === "rejected");
    }
  });

  it("concurrent reopen attempts: one reopened outcome, monotonic occurrence_count", async () => {
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:concurrent-reopen:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, ambiguousPhase2Input(dedupeKey));
    const envelope = {
      retrySafety: incident.retrySafety,
      permittedActions: incident.permittedActions,
    };
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "closed",
      incidentVersion: incident.incidentVersion,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        recordIncident(repo, ambiguousPhase2Input(dedupeKey), { reopenIfResolved: true }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof recordIncident>>
    >[];
    assert.ok(fulfilled.length >= 1);
    const reopened = fulfilled.filter((r) => r.value.outcome === "reopened");
    const occurrences = fulfilled.filter((r) => r.value.outcome === "occurrence");
    assert.equal(reopened.length, 1);
    assert.equal(occurrences.length, fulfilled.length - 1);

    const final = await repo.findByDedupeKey(dedupeKey);
    assert.ok(final);
    assert.equal(final.id, incident.id);
    assert.equal(final.status, "open");
    assert.equal(final.occurrenceCount, incident.occurrenceCount + fulfilled.length);
    assertEnvelopeUnchanged(envelope, final);
    assert.equal(await countIncidentRowsByDedupe(dedupeKey), 1);
  });
});

function eventsCount(
  events: { eventType: string }[],
  type: string,
): number {
  return events.filter((e) => e.eventType === type).length;
}

async function countIncidentRowsByDedupe(dedupeKey: string): Promise<number> {
  const sql = neon(testDbUrl);
  const rows = await sql`
    SELECT COUNT(*)::int AS count FROM marketing_incidents WHERE dedupe_key = ${dedupeKey}
  `;
  return Number((rows[0] as { count: number }).count ?? 0);
}

async function loadByDedupeOrId(
  repo: ReturnType<typeof createPostgresIncidentRepository>,
  dedupeKey: string,
  id: string,
) {
  return (await repo.findByDedupeKey(dedupeKey)) ?? (await repo.findById(id));
}
