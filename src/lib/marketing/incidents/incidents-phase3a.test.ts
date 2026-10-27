import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it, test } from "node:test";
import { neon } from "@neondatabase/serverless";
import { parseMarketingIncidentsNotificationLinkageStatements } from "../../../../scripts/apply-marketing-incidents-notification-linkage.mjs";
import { parseMarketingIncidentsMigrationStatements } from "../../../../scripts/apply-marketing-incidents-schema.mjs";
import { parseMarketingWebPushMigrationStatements } from "../../../../scripts/apply-marketing-web-push-schema.mjs";
import { resolveMarketingIncidentsTestDatabaseUrl } from "../../../../scripts/resolve-marketing-incidents-test-database-url.mjs";
import { MemoryMarketingStore } from "../memory-store";
import { createMemoryIncidentRepository } from "./memory-repository";
import { resetIncidentDedupeLocksForTests } from "./dedupe-lock";
import {
  IllegalIncidentTransitionError,
} from "./lifecycle";
import {
  IncidentVersionConflictError,
  recordIncident,
  resolveIncident,
  transitionIncidentStatus,
} from "./record";
import { serializeIncidentForApi } from "./api-serialization";
import { listIncidentsFromPostgres } from "./postgres-repository";
import { setMarketingIncidentRepositoryForTests } from "./runtime-repository";
import type { MarketingNotificationPayload } from "../notifications/types";
import { notifyPublicationAmbiguousOutcomeWithDeps } from "../publication-ambiguity/notify";
import { runReliabilityAlertPipeline } from "../reliability/sweep";
import { retryAdminPublication } from "../publication-retry";
import type { MarketingPublication } from "../types";
import { recordPublicationAmbiguousOutcomeIncident } from "../publication-incidents/ambiguous";
import { observePublicationRecoveryRequired } from "../publication-incidents/recovery-required";
import { buildPublicationRecoveryRequiredNotificationPayload } from "../publication-incidents/recovery-notify";
import { publicationAmbiguousIncidentDedupeKey } from "../publication-incidents/dedupe-keys";

const linkageMigrationPath = fileURLToPath(
  new URL("../../../../sql/marketing-incidents-notification-linkage.sql", import.meta.url),
);
const webPushMigrationPath = fileURLToPath(
  new URL("../../../../sql/marketing-web-push.sql", import.meta.url),
);
const incidentsMigrationPath = fileURLToPath(
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

function basePublication(
  patch: Partial<MarketingPublication> & { id: string },
): MarketingPublication {
  const now = new Date().toISOString();
  return {
    contentId: "content-1",
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: `key:${patch.id}`,
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "meta_container_status_timeout: container not ready",
    scheduledFor: null,
    publishedAt: null,
    ambiguityState: "ambiguous",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: "18104922968283771",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function baseIncidentInput(dedupeKey: string) {
  return {
    incidentType: "publication_ambiguous",
    status: "action_required",
    severity: "error",
    sourceOperation: "test",
    dedupeKey,
    errorClass: "meta_http_error",
    errorMessage: "timeout",
    retrySafety: "unknown_requires_verification",
    permittedActions: ["investigate_read_only"],
    publicationId: "pub-1",
  };
}

describe("Phase III-A lifecycle core", () => {
  it("legal lifecycle transition", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseIncidentInput("dedupe:legal"));
    const updated = await transitionIncidentStatus(
      repo,
      incident.id,
      "investigating",
      "owner@test",
      incident.incidentVersion,
    );
    assert.equal(updated.status, "investigating");
    assert.equal(updated.incidentVersion, incident.incidentVersion + 1);
  });

  it("illegal lifecycle transition rejected", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseIncidentInput("dedupe:illegal"));
    const resolved = await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "done",
      incidentVersion: incident.incidentVersion,
    });
    await assert.rejects(
      () =>
        transitionIncidentStatus(
          repo,
          resolved.id,
          "investigating",
          "owner@test",
          resolved.incidentVersion,
        ),
      IllegalIncidentTransitionError,
    );
  });

  it("stale incident_version conflict", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseIncidentInput("dedupe:stale"));
    await assert.rejects(
      () =>
        transitionIncidentStatus(repo, incident.id, "investigating", "owner@test", 999),
      IncidentVersionConflictError,
    );
  });

  it("manual resolution produces zero publication side effects", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const pub = basePublication({ id: "pub-resolve-sidefx", ambiguityState: "ambiguous" });
    await store.createPublication(pub);
    const { incident } = await recordIncident(
      repo,
      baseIncidentInput(publicationAmbiguousIncidentDedupeKey(pub.id)),
    );
    const before = await store.getPublication(pub.id);
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Reviewed; publication unchanged.",
      actor: "owner@test",
      incidentVersion: incident.incidentVersion,
    });
    const after = await store.getPublication(pub.id);
    assert.deepEqual(after, before);
  });

  it("genuine recurrence reopens same incident ID with preserved envelope", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({ id: "pub-reopen" });
    const first = await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    assert.ok(first);
    const correlation = first.agentWorkCorrelationId;
    await resolveIncident(repo, first.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "closed",
      incidentVersion: first.incidentVersion,
    });
    const reopened = await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    assert.ok(reopened);
    assert.equal(reopened.id, first.id);
    assert.equal(reopened.agentWorkCorrelationId, correlation);
    assert.equal(reopened.occurrenceCount, 2);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.resolutionType, null);
    assert.equal(reopened.retrySafety, first.retrySafety);
    assert.deepEqual(reopened.permittedActions, first.permittedActions);
  });

  it("sanitized API evidence", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, {
      ...baseIncidentInput("dedupe:sanitize"),
      errorMessage: "Bearer totally-secret",
      evidence: { authorization: "Bearer totally-secret" },
    });
    const api = serializeIncidentForApi(incident);
    const raw = JSON.stringify(api);
    assert.ok(!raw.includes("totally-secret"));
  });
});

describe("Phase III-A notification linkage", () => {
  it("ambiguous notification links incident when provided", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({ id: "pub-link-amb" });
    const incident = await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    assert.ok(incident);
    let captured: MarketingNotificationPayload | undefined;
    await notifyPublicationAmbiguousOutcomeWithDeps(
      pub,
      undefined,
      {
        claimDedupe: async () => true,
        notify: async (payload) => {
          captured = payload;
          return { notificationId: crypto.randomUUID(), pushDelivered: 0 };
        },
        attachDedupe: async () => {},
        releaseDedupe: async () => {},
      },
      incident.id,
    );
    assert.ok(captured);
    assert.equal(captured.relatedIncidentId, incident.id);
  });

  it("overdue and stuck notifications receive relatedIncidentId in sweep pipeline", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const now = Date.now();
    const overduePub = basePublication({
      id: "pub-overdue-link",
      status: "scheduled",
      ambiguityState: "none",
      scheduledFor: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
    });
    const stuckPub = basePublication({
      id: "pub-stuck-link",
      status: "processing",
      ambiguityState: "none",
      processingStartedAt: new Date(now - 40 * 60 * 1000).toISOString(),
    });
    const payloads: MarketingNotificationPayload[] = [];
    await runReliabilityAlertPipeline(
      { overdue: [overduePub], stuck: [stuckPub] },
      {
        claimDedupe: async () => true,
        notify: async (payload) => {
          payloads.push(payload);
          return { notificationId: crypto.randomUUID() };
        },
        attachDedupe: async () => {},
        releaseDedupe: async () => {},
      },
    );
    setMarketingIncidentRepositoryForTests(null);
    const incidents = repo.listIncidents();
    assert.equal(incidents.length, 2);
    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
      assert.ok(payload.relatedIncidentId);
      const linked = incidents.find((i) => i.id === payload.relatedIncidentId);
      assert.ok(linked);
    }
    const stuckIncident = incidents.find((i) => i.incidentType === "publication_stuck_processing");
    assert.ok(stuckIncident);
    const stuckPayload = payloads.find((p) => p.type === "publication_ambiguous");
    assert.ok(stuckPayload);
    assert.equal(stuckPayload.relatedIncidentId, stuckIncident.id);
  });

  it("recovery-required observability records incident and keeps guard blocked", async () => {
    const store = new MemoryMarketingStore();
    const pub = basePublication({
      id: "pub-recovery-link",
      platform: "instagram",
      status: "failed",
      externalId: null,
      providerCreationId: "18104922968283771",
    });
    await store.createPublication(pub);
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);

    const incident = await observePublicationRecoveryRequired(pub, "test_recovery");
    assert.ok(incident);
    assert.equal(incident.incidentType, "publication_recovery_required");
    assert.equal(repo.listIncidents().length, 1);

    const result = await retryAdminPublication(store, pub.id);
    assert.equal(result.status, 409);
    setMarketingIncidentRepositoryForTests(null);
  });

  it("recovery-required notification payload includes incident linkage and push", () => {
    const payload = buildPublicationRecoveryRequiredNotificationPayload(
      basePublication({ id: "pub-rec-payload" }),
      "incident-uuid",
    );
    assert.equal(payload.relatedIncidentId, "incident-uuid");
    assert.equal(payload.type, "publication_recovery_required");
    const notifySrc = readFileSync(
      fileURLToPath(new URL("../publication-incidents/recovery-notify.ts", import.meta.url)),
      "utf8",
    );
    assert.match(notifySrc, /deliverPush:\s*true/);
  });

  it("notification creation failure leaves incident intact", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({ id: "pub-notify-fail" });
    const incident = await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    assert.ok(incident);
    await notifyPublicationAmbiguousOutcomeWithDeps(
      pub,
      undefined,
      {
        claimDedupe: async () => true,
        notify: async () => {
          throw new Error("simulated notify failure");
        },
        attachDedupe: async () => {},
        releaseDedupe: async () => {},
      },
      incident.id,
    );
    const loaded = await repo.findById(incident.id);
    assert.ok(loaded);
    assert.equal(loaded.occurrenceCount, 1);
  });
});

test("migration parser: notification linkage SQL", () => {
  const sql = readFileSync(linkageMigrationPath, "utf8");
  const statements = parseMarketingIncidentsNotificationLinkageStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /related_incident_id UUID/);
  assert.match(statements[1], /marketing_admin_notifications_related_incident_idx/);
});

test("admin API routes do not expose publication mutation or Meta endpoints", () => {
  const apiRoot = fileURLToPath(
    new URL("../../../app/api/admin/marketing/incidents", import.meta.url),
  );
  const files = [
    "route.ts",
    "[incidentId]/route.ts",
    "[incidentId]/transition/route.ts",
    "[incidentId]/resolve/route.ts",
  ];
  for (const file of files) {
    const src = readFileSync(`${apiRoot}/${file}`, "utf8");
    assert.match(src, /requireMarketingAdmin/);
    assert.doesNotMatch(src, /\bmeta\b|\/retry|reconcile|updatePublication/i);
  }
});

describe("Phase III-A postgres list/get", { skip: !testDbUrl }, () => {
  before(async () => {
    process.env.DATABASE_URL = testDbUrl;
    const sql = neon(testDbUrl);
    for (const statement of parseMarketingWebPushMigrationStatements(
      readFileSync(webPushMigrationPath, "utf8"),
    )) {
      await sql.query(statement);
    }
    for (const statement of parseMarketingIncidentsMigrationStatements(
      readFileSync(incidentsMigrationPath, "utf8"),
    )) {
      await sql.query(statement);
    }
    for (const statement of parseMarketingIncidentsNotificationLinkageStatements(
      readFileSync(linkageMigrationPath, "utf8"),
    )) {
      await sql.query(statement);
    }
  });

  it("lists incidents and verifies linkage column", async () => {
    const sql = neon(testDbUrl);
    const columns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'marketing_admin_notifications'
        AND column_name = 'related_incident_id'
    `;
    assert.equal(columns.length, 1);
    const listed = await listIncidentsFromPostgres({
      limit: 5,
      publicationId: "00000000-0000-0000-0000-000000000000",
    });
    assert.ok(Array.isArray(listed));
    assert.equal(listed.length, 0);
  });
});
