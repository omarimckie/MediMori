import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { neon } from "@neondatabase/serverless";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";
import { resolveMarketingIncidentsTestDatabaseUrl } from "../../../../scripts/resolve-marketing-incidents-test-database-url.mjs";
import {
  adminResolveIncident,
  adminTransitionIncident,
  IncidentResolveRequiresDedicatedEndpointError,
  incidentHttpError,
} from "./admin-http";
import { IncidentValidationError } from "./validate";
import { createMemoryIncidentRepository } from "./memory-repository";
import { resetIncidentDedupeLocksForTests } from "./dedupe-lock";
import { createPostgresIncidentRepository } from "./postgres-repository";
import { recordIncident, resolveIncident } from "./record";

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

function baseInput(dedupeKey: string) {
  return {
    incidentType: "publication_ambiguous",
    status: "open",
    severity: "error",
    sourceOperation: "phase3a_admin_http",
    dedupeKey,
    errorClass: "meta_http_error",
    errorMessage: "timeout",
    retrySafety: "unknown_requires_verification",
    permittedActions: ["investigate_read_only"],
    publicationId: "00000000-0000-4000-8000-0000000000a3",
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

describe("Phase III-A3 admin HTTP hardening", () => {
  it("rejects generic transition to resolved before touching storage", async () => {
    await assert.rejects(
      () =>
        adminTransitionIncident({
          incidentId: "00000000-0000-4000-8000-000000000099",
          status: "resolved",
          incidentVersion: 1,
          actor: "owner@test",
        }),
      IncidentResolveRequiresDedicatedEndpointError,
    );
  });

  it("maps resolve-via-transition validation to HTTP 400", () => {
    const mapped = incidentHttpError(new IncidentResolveRequiresDedicatedEndpointError());
    assert.equal(mapped?.status, 400);
    assert.match(mapped?.message ?? "", /resolve/i);
  });

  it("rejects unknown incident status before repository access", async () => {
    await assert.rejects(
      () =>
        adminTransitionIncident({
          incidentId: "00000000-0000-4000-8000-000000000099",
          status: "not_a_real_status",
          incidentVersion: 1,
          actor: "owner@test",
        }),
      IncidentValidationError,
    );
  });

  it("dedicated resolve on memory repo still emits incident_resolved", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput(`mem:resolve:${crypto.randomUUID()}`));
    const resolved = await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Reviewed.",
      incidentVersion: incident.incidentVersion,
      actor: "owner@test",
    });
    assert.equal(resolved.status, "resolved");
    const events = await repo.listEvents(incident.id);
    assert.ok(events.some((e) => e.eventType === "incident_resolved"));
  });
});

describe("Phase III-A3 Postgres transition-to-resolved noop", { skip: !testDbUrl }, () => {
  before(async () => {
    process.env.DATABASE_URL = testDbUrl;
    await applyIncidentsSchema(testDbUrl);
  });

  it("transition resolved is rejected with no version or status_changed side effects", async () => {
    const repo = createPostgresIncidentRepository();
    const dedupeKey = `pg:admin-no-resolve-transition:${crypto.randomUUID()}`;
    const { incident } = await recordIncident(repo, baseInput(dedupeKey));
    const versionBefore = incident.incidentVersion;
    const statusBefore = incident.status;

    await assert.rejects(
      () =>
        adminTransitionIncident({
          incidentId: incident.id,
          status: "resolved",
          incidentVersion: versionBefore,
          actor: "owner@test",
        }),
      IncidentResolveRequiresDedicatedEndpointError,
    );

    const afterReject = await repo.findById(incident.id);
    assert.ok(afterReject);
    assert.equal(afterReject.incidentVersion, versionBefore);
    assert.equal(afterReject.status, statusBefore);
    const eventsAfterReject = await repo.listEvents(incident.id);
    assert.equal(
      eventsAfterReject.filter((e) => e.eventType === "status_changed").length,
      0,
    );
    assert.equal(
      eventsAfterReject.filter((e) => e.eventType === "incident_resolved").length,
      0,
    );
    assert.equal(afterReject.resolutionType, null);
    assert.equal(afterReject.resolutionSummary, null);
    assert.equal(afterReject.resolvedAt, null);

    const resolved = await adminResolveIncident({
      incidentId: incident.id,
      resolutionType: "false_positive",
      resolutionSummary: "Noise.",
      incidentVersion: versionBefore,
      actor: "owner@test",
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.incidentVersion, versionBefore + 1);
    assert.equal(resolved.resolutionType, "false_positive");
    assert.equal(resolved.resolutionSummary, "Noise.");
    assert.ok(resolved.resolvedAt);
    const eventsAfterResolve = await repo.listEvents(incident.id);
    assert.equal(
      eventsAfterResolve.filter((e) => e.eventType === "incident_resolved").length,
      1,
    );
    assert.equal(
      eventsAfterResolve.filter((e) => e.eventType === "status_changed").length,
      0,
    );
  });
});
