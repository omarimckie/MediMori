import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { neon } from "@neondatabase/serverless";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";
import { resolveMarketingIncidentsTestDatabaseUrl } from "../../../../scripts/resolve-marketing-incidents-test-database-url.mjs";
import { createPostgresIncidentRepository } from "./postgres-repository";
import {
  listAutoResolveCandidateIncidents,
  publicationIdsWithUnresolvedManualIncidents,
} from "./postgres-repository";
import { IncidentVersionConflictError } from "./errors";
import { recordIncident, resolveIncident } from "./record";
import {
  RECONCILER_ACTOR,
  reconcileAutoResolvableIncidents,
  type IncidentReconcileDeps,
} from "../reliability/incident-reconcile";
import type { MarketingPublication } from "../types";
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

function overdueInput(dedupeKey: string, publicationId: string) {
  return {
    incidentType: "publication_overdue",
    status: "open",
    severity: "warning",
    sourceOperation: "phase3a4_pg",
    dedupeKey,
    errorClass: "publication_overdue",
    errorMessage: "overdue",
    retrySafety: "not_applicable",
    permittedActions: ["investigate_read_only"],
    publicationId,
  };
}

function ambiguousInput(dedupeKey: string, publicationId: string) {
  return {
    incidentType: "publication_ambiguous",
    status: "action_required",
    severity: "error",
    sourceOperation: "phase3a4_pg",
    dedupeKey,
    errorClass: "publication_ambiguous",
    errorMessage: "ambiguous",
    retrySafety: "unsafe_duplicate_risk",
    permittedActions: ["investigate_read_only"],
    publicationId,
  };
}

function recoveryInput(dedupeKey: string, publicationId: string) {
  return {
    incidentType: "publication_recovery_required",
    status: "action_required",
    severity: "error",
    sourceOperation: "phase3a4_pg",
    dedupeKey,
    errorClass: "publication_recovery_required",
    errorMessage: "recovery",
    retrySafety: "unsafe_duplicate_risk",
    permittedActions: ["investigate_read_only"],
    publicationId,
  };
}

function publishedPublication(publicationId: string): MarketingPublication {
  const now = new Date().toISOString();
  return {
    id: publicationId,
    contentId: "00000000-0000-4000-8000-000000000001",
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "published",
    idempotencyKey: "k",
    externalId: "ext",
    url: null,
    attemptCount: 1,
    lastError: null,
    scheduledFor: now,
    publishedAt: now,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function postgresReconcileDeps(
  repo: ReturnType<typeof createPostgresIncidentRepository>,
  publicationId: string,
  incidentId?: string,
): IncidentReconcileDeps {
  return {
    repository: repo,
    listCandidates: async (limit) => {
      const rows = await listAutoResolveCandidateIncidents(limit);
      if (!incidentId) {
        return rows;
      }
      return rows.filter((row) => row.id === incidentId);
    },
    getPublication: async () => publishedPublication(publicationId),
    manualBlockerPublicationIds: publicationIdsWithUnresolvedManualIncidents,
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

describe("Phase III-A4 Postgres reconcile concurrency", { skip: !testDbUrl }, () => {
  before(async () => {
    process.env.DATABASE_URL = testDbUrl;
    const host = new URL(testDbUrl).hostname;
    if (host.includes("ep-muddy-math-auxmesyz")) {
      throw new Error("Refusing production Neon for III-A4 tests");
    }
    await applyIncidentsSchema(testDbUrl);
  });

  it("auto-resolve uses auto_recovered and emits single incident_resolved", async () => {
    const repo = createPostgresIncidentRepository();
    const publicationId = "00000000-0000-4000-8000-00000000a401";
    const dedupeKey = `pg:a4:auto:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, overdueInput(dedupeKey, publicationId));

    const deps = postgresReconcileDeps(repo, publicationId, incident.id);
    deps.manualBlockerPublicationIds = async () => new Set();

    const stats = await reconcileAutoResolvableIncidents(deps);
    assert.equal(stats.autoResolved, 1);
    const final = await repo.findById(incident.id);
    assert.equal(final?.status, "resolved");
    assert.equal(final?.resolutionType, "auto_recovered");
    const events = await repo.listEvents(incident.id);
    assert.equal(events.filter((e) => e.eventType === "incident_resolved").length, 1);
    assert.equal(events.filter((e) => e.eventType === "status_changed").length, 0);
  });

  it("owner resolve wins; stale auto resolve conflicts on same version", async () => {
    const repo = createPostgresIncidentRepository();
    const publicationId = "00000000-0000-4000-8000-00000000a402";
    const dedupeKey = `pg:a4:race:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, overdueInput(dedupeKey, publicationId));
    const versionAtStart = incident.incidentVersion;
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Owner",
      incidentVersion: versionAtStart,
    });
    await assert.rejects(
      resolveIncident(repo, incident.id, {
        resolutionType: "auto_recovered",
        resolutionSummary: "Stale auto.",
        incidentVersion: versionAtStart,
        actor: RECONCILER_ACTOR,
      }),
      IncidentVersionConflictError,
    );
    const final = await repo.findById(incident.id);
    assert.equal(final?.resolutionType, "owner_resolved");
    const events = await repo.listEvents(incident.id);
    assert.equal(events.filter((e) => e.eventType === "incident_resolved").length, 1);
    assert.equal(events.filter((e) => e.eventType === "status_changed").length, 0);
  });

  it("concurrent double reconciler resolves exactly once", async () => {
    const repo = createPostgresIncidentRepository();
    const publicationId = "00000000-0000-4000-8000-00000000a403";
    const dedupeKey = `pg:a4:double:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, overdueInput(dedupeKey, publicationId));
    const deps = postgresReconcileDeps(repo, publicationId, incident.id);
    const [left, right] = await Promise.all([
      reconcileAutoResolvableIncidents(deps),
      reconcileAutoResolvableIncidents(deps),
    ]);
    assert.equal(left.autoResolved + right.autoResolved, 1);
    assert.ok(left.skippedConflict + right.skippedConflict >= 1);
    const final = await repo.findById(incident.id);
    assert.equal(final?.status, "resolved");
    assert.equal(final?.resolutionType, "auto_recovered");
    assert.ok((final?.incidentVersion ?? 0) > incident.incidentVersion);
    const events = await repo.listEvents(incident.id);
    assert.equal(events.filter((e) => e.eventType === "incident_resolved").length, 1);
    assert.equal(events.filter((e) => e.eventType === "status_changed").length, 0);
  });

  it("stale auto-resolution cannot overwrite recurrence reopen", async () => {
    const repo = createPostgresIncidentRepository();
    const publicationId = "00000000-0000-4000-8000-00000000a404";
    const dedupeKey = `pg:a4:reopen:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, overdueInput(dedupeKey, publicationId));
    const staleVersion = incident.incidentVersion;
    const deps = postgresReconcileDeps(repo, publicationId, incident.id);
    await reconcileAutoResolvableIncidents(deps);
    const afterAuto = await repo.findById(incident.id);
    assert.equal(afterAuto?.status, "resolved");

    const { incident: reopened } = await recordIncident(
      repo,
      overdueInput(dedupeKey, publicationId),
      { reopenIfResolved: true },
    );
    assert.equal(reopened.id, incident.id);
    assert.equal(reopened.status, "open");
    assert.ok(reopened.incidentVersion > staleVersion);

    await assert.rejects(
      resolveIncident(repo, incident.id, {
        resolutionType: "auto_recovered",
        resolutionSummary: "Stale after reopen.",
        incidentVersion: staleVersion,
        actor: RECONCILER_ACTOR,
      }),
      IncidentVersionConflictError,
    );
    const final = await repo.findById(incident.id);
    assert.equal(final?.status, "open");
    const events = await repo.listEvents(incident.id);
    assert.equal(events.filter((e) => e.eventType === "incident_resolved").length, 1);
    assert.ok(events.some((e) => e.eventType === "incident_reopened"));
  });

  it("manual blocker query: unresolved ambiguous blocks, resolved does not", async () => {
    const repo = createPostgresIncidentRepository();
    const publicationId = "00000000-0000-4000-8000-00000000a405";
    const ambKey = `pg:a4:amb:${crypto.randomUUID()}`;
    const { incident: ambiguous } = await recordIncident(
      repo,
      ambiguousInput(ambKey, publicationId),
    );
    let blocked = await publicationIdsWithUnresolvedManualIncidents([publicationId]);
    assert.equal(blocked.has(publicationId), true);
    await resolveIncident(repo, ambiguous.id, {
      resolutionType: "false_positive",
      resolutionSummary: "Historical ambiguous.",
      incidentVersion: ambiguous.incidentVersion,
    });
    blocked = await publicationIdsWithUnresolvedManualIncidents([publicationId]);
    assert.equal(blocked.has(publicationId), false);
  });

  it("manual blocker query: unresolved recovery_required blocks, resolved does not", async () => {
    const repo = createPostgresIncidentRepository();
    const publicationId = "00000000-0000-4000-8000-00000000a406";
    const recKey = `pg:a4:rec:${crypto.randomUUID()}`;
    const { incident: recovery } = await recordIncident(
      repo,
      recoveryInput(recKey, publicationId),
    );
    let blocked = await publicationIdsWithUnresolvedManualIncidents([publicationId]);
    assert.equal(blocked.has(publicationId), true);
    await resolveIncident(repo, recovery.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Recovery handled.",
      incidentVersion: recovery.incidentVersion,
    });
    blocked = await publicationIdsWithUnresolvedManualIncidents([publicationId]);
    assert.equal(blocked.has(publicationId), false);
  });
});
