import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { neon } from "@neondatabase/serverless";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";
import { resolveMarketingIncidentsTestDatabaseUrl } from "../../../../scripts/resolve-marketing-incidents-test-database-url.mjs";
import { createPostgresIncidentRepository } from "./postgres-repository";
import { recordIncident, resolveIncident } from "./record";
import {
  publicationFailedIncidentDedupeKey,
  smartUploadFinalizeFailedIncidentDedupeKey,
} from "../publication-incidents/dedupe-keys";
import { sanitizeEvidence } from "./sanitize";

const migrationSqlPath = fileURLToPath(
  new URL("../../../../sql/marketing-incidents.sql", import.meta.url),
);

const ENGINEERING_HOST = "ep-gentle-dawn-au6vxirn-pooler.c-10.us-east-1.aws.neon.tech";

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

function publicationFailedInput(publicationId: string) {
  const dedupeKey = publicationFailedIncidentDedupeKey(publicationId);
  return {
    incidentType: "publication_failed",
    status: "action_required",
    severity: "error",
    sourceOperation: "phase3b1_pg",
    dedupeKey,
    errorClass: "meta_http_error",
    errorMessage: "failed",
    retrySafety: "safe_manual",
    permittedActions: ["investigate_read_only", "notify_owner"],
    publicationId,
    platform: "instagram",
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

describe("Phase III-B1 Postgres incident dedupe", { skip: !testDbUrl }, () => {
  before(async () => {
    assert.ok(
      testDbUrl.includes(ENGINEERING_HOST),
      `expected engineering Neon host ${ENGINEERING_HOST}`,
    );
    process.env.DATABASE_URL = testDbUrl;
    await applyIncidentsSchema(testDbUrl);
  });

  it("concurrent publication_failed writers dedupe to one incident", async () => {
    const publicationId = crypto.randomUUID();
    const repo = createPostgresIncidentRepository();
    const input = publicationFailedInput(publicationId);
    const [a, b] = await Promise.all([
      recordIncident(repo, input, { reopenIfResolved: true }),
      recordIncident(repo, input, { reopenIfResolved: true }),
    ]);
    const outcomes = new Set([a.outcome, b.outcome]);
    assert.ok(outcomes.has("created"));
    assert.ok(outcomes.has("occurrence") || outcomes.size === 1);
    assert.equal(a.incident.id, b.incident.id);
    assert.equal(a.incident.dedupeKey, publicationFailedIncidentDedupeKey(publicationId));
  });

  it("append-only incident events on create and occurrence", async () => {
    const publicationId = crypto.randomUUID();
    const repo = createPostgresIncidentRepository();
    const first = await recordIncident(repo, publicationFailedInput(publicationId), {
      reopenIfResolved: true,
    });
    const eventsAfterCreate = await repo.listEvents(first.incident.id);
    assert.ok(eventsAfterCreate.some((e) => e.eventType === "incident_created"));

    await recordIncident(repo, publicationFailedInput(publicationId), {
      reopenIfResolved: true,
    });
    const eventsAfterOccurrence = await repo.listEvents(first.incident.id);
    assert.ok(
      eventsAfterOccurrence.some((e) => e.eventType === "occurrence_recorded"),
    );
    assert.equal(eventsAfterOccurrence.length, eventsAfterCreate.length + 1);
  });

  it("persisted evidence sanitizes nested secrets", async () => {
    const publicationId = crypto.randomUUID();
    const repo = createPostgresIncidentRepository();
    const sentinel = "SENTINEL_B1_PG_SECRET_TOKEN";
    const result = await recordIncident(
      repo,
      {
        ...publicationFailedInput(publicationId),
        errorMessage: `Authorization: Bearer ${sentinel}`,
        evidence: sanitizeEvidence({
          nested: {
            Authorization: `Bearer ${sentinel}`,
            cookie: `session=${sentinel}`,
            CRON_SECRET: sentinel,
          },
        }),
      },
      { reopenIfResolved: true },
    );
    const persisted = result.incident;
    const blob = JSON.stringify(persisted) + persisted.sanitizedError;
    assert.ok(!blob.includes(sentinel));
  });

  it("smart_upload_finalize_failed dedupes by finalizeKey", async () => {
    const finalizeKey = `b1-pg-finalize-${crypto.randomUUID()}`;
    const repo = createPostgresIncidentRepository();
    const input = {
      incidentType: "smart_upload_finalize_failed",
      status: "action_required",
      severity: "error",
      sourceOperation: "phase3b1_pg_finalize",
      dedupeKey: smartUploadFinalizeFailedIncidentDedupeKey(finalizeKey),
      errorClass: "smart_upload_finalize_failed",
      errorMessage: "failed",
      retrySafety: "safe_manual",
      permittedActions: ["investigate_read_only", "no_op"],
      finalizeKey,
    };
    const [a, b] = await Promise.all([
      recordIncident(repo, input, { reopenIfResolved: true }),
      recordIncident(repo, input, { reopenIfResolved: true }),
    ]);
    assert.equal(a.incident.id, b.incident.id);
  });

  it("resolved publication_failed reopens with stable id and reopened event", async () => {
    const publicationId = crypto.randomUUID();
    const repo = createPostgresIncidentRepository();
    const first = await recordIncident(repo, publicationFailedInput(publicationId), {
      reopenIfResolved: true,
    });
    await resolveIncident(repo, first.incident.id, {
      resolutionType: "owner_resolved",
      actor: "owner",
      resolutionSummary: "done",
    });
    const second = await recordIncident(repo, publicationFailedInput(publicationId), {
      reopenIfResolved: true,
    });
    assert.equal(second.outcome, "reopened");
    assert.equal(second.incident.id, first.incident.id);
    assert.ok(second.incident.incidentVersion > first.incident.incidentVersion);
    const events = await repo.listEvents(first.incident.id);
    assert.ok(events.some((e) => e.eventType === "incident_reopened"));
  });
});
