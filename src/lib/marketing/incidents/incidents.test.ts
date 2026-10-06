import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetIncidentDedupeLocksForTests } from "./dedupe-lock";
import { IllegalIncidentTransitionError, legalTransitionsFrom } from "./lifecycle";
import { createMemoryIncidentRepository } from "./memory-repository";
import { IncidentDedupeResolvedError } from "./errors";
import {
  recordIncident,
  resolveIncident,
  transitionIncidentStatus,
} from "./record";
import {
  MAX_EVIDENCE_JSON_BYTES,
  REDACTED_PLACEHOLDER,
  sanitizeEvidence,
} from "./sanitize";
import { IncidentValidationError, parsePermittedActions, parseRetrySafety } from "./validate";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    incidentType: "publication_failed",
    severity: "error",
    sourceOperation: "publish",
    dedupeKey: `test:pub:${crypto.randomUUID()}`,
    errorClass: "meta_http_error",
    errorMessage: "Provider HTTP 503",
    retrySafety: "safe_manual",
    permittedActions: ["investigate_read_only", "admin_retry_publication"],
    ...overrides,
  };
}

describe("marketing incidents Phase I", () => {
  it("creates one incident and incident_created event", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const result = await recordIncident(repo, baseInput());
    assert.equal(result.outcome, "created");
    assert.equal(result.incident.status, "open");
    assert.equal(result.incident.occurrenceCount, 1);
    const events = await repo.listEvents(result.incident.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "incident_created");
  });

  it("same dedupe key records recurrence, not second incident", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:recurrence:one";
    const first = await recordIncident(repo, baseInput({ dedupeKey }));
    const second = await recordIncident(repo, baseInput({ dedupeKey }));
    assert.equal(second.outcome, "occurrence");
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(second.incident.id, first.incident.id);
  });

  it("occurrence_count increments correctly", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:count";
    await recordIncident(repo, baseInput({ dedupeKey }));
    const second = await recordIncident(repo, baseInput({ dedupeKey }));
    const third = await recordIncident(repo, baseInput({ dedupeKey }));
    assert.equal(third.incident.occurrenceCount, 3);
    assert.equal(second.incident.occurrenceCount, 2);
  });

  it("preserves first_seen_at on recurrence", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:first-seen";
    const firstSeen = "2026-01-01T12:00:00.000Z";
    const first = await recordIncident(
      repo,
      baseInput({ dedupeKey, detectedAt: firstSeen, occurredAt: firstSeen }),
    );
    const second = await recordIncident(
      repo,
      baseInput({ dedupeKey, detectedAt: "2026-01-02T12:00:00.000Z" }),
    );
    assert.equal(second.incident.firstSeenAt, first.incident.firstSeenAt);
    assert.equal(second.incident.firstSeenAt, firstSeen);
  });

  it("advances last_seen_at on recurrence", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:last-seen";
    await recordIncident(repo, baseInput({ dedupeKey, detectedAt: "2026-01-01T12:00:00.000Z" }));
    const second = await recordIncident(
      repo,
      baseInput({ dedupeKey, detectedAt: "2026-01-03T12:00:00.000Z" }),
    );
    assert.equal(second.incident.lastSeenAt, "2026-01-03T12:00:00.000Z");
  });

  it("rejects illegal lifecycle transition", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput());
    await transitionIncidentStatus(repo, incident.id, "investigating");
    await assert.rejects(
      () => transitionIncidentStatus(repo, incident.id, "open"),
      IllegalIncidentTransitionError,
    );
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Done",
    });
    await assert.rejects(
      () => transitionIncidentStatus(repo, incident.id, "investigating"),
      IllegalIncidentTransitionError,
    );
    assert.deepEqual(legalTransitionsFrom("resolved"), []);
  });

  it("legal transition creates status_changed event", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput());
    await transitionIncidentStatus(repo, incident.id, "investigating");
    const events = await repo.listEvents(incident.id);
    const statusEvent = events.find((e) => e.eventType === "status_changed");
    assert.ok(statusEvent);
    assert.equal(statusEvent?.payload.from, "open");
    assert.equal(statusEvent?.payload.to, "investigating");
  });

  it("resolution creates incident_resolved event", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput());
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Owner verified Meta state.",
    });
    const events = await repo.listEvents(incident.id);
    assert.ok(events.some((e) => e.eventType === "incident_resolved"));
    const row = await repo.findById(incident.id);
    assert.equal(row?.status, "resolved");
  });

  it("explicit recurrence reopens resolved incident", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:reopen";
    const { incident } = await recordIncident(repo, baseInput({ dedupeKey }));
    await resolveIncident(repo, incident.id, {
      resolutionType: "auto_recovered",
      resolutionSummary: "Recovered",
    });
    await assert.rejects(
      () => recordIncident(repo, baseInput({ dedupeKey })),
      IncidentDedupeResolvedError,
    );
    const reopened = await recordIncident(repo, baseInput({ dedupeKey }), {
      reopenIfResolved: true,
    });
    assert.equal(reopened.outcome, "reopened");
    assert.equal(reopened.incident.status, "open");
    const events = await repo.listEvents(incident.id);
    assert.ok(events.some((e) => e.eventType === "incident_reopened"));
  });

  it("unknown permitted action fails closed", () => {
    assert.throws(
      () => parsePermittedActions(["investigate_read_only", "autonomous_meta_publish"]),
      IncidentValidationError,
    );
  });

  it("unknown retry safety fails closed", () => {
    assert.throws(() => parseRetrySafety("retry_everything"), IncidentValidationError);
  });

  it("evidence sanitizes representative secrets", () => {
    const out = sanitizeEvidence({
      authorization: "Bearer secret-token-12345",
      note: "Authorization: Bearer abc.def.ghi",
      batchId: "70193734-fd59-4ea7-a6bc-3463cf68d413",
    });
    assert.equal(out.authorization, REDACTED_PLACEHOLDER);
    assert.match(String(out.note), /REDACTED/);
    assert.equal(out.batchId, "70193734-fd59-4ea7-a6bc-3463cf68d413");
  });

  it("event payload sanitizes representative secrets", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput());
    await repo.appendEvent({
      id: crypto.randomUUID(),
      incidentId: incident.id,
      eventType: "status_changed",
      actor: "system",
      payload: { authorization: "Bearer top-secret-value" },
    });
    const events = await repo.listEvents(incident.id);
    const statusEvent = events.find((e) => e.eventType === "status_changed");
    assert.ok(statusEvent);
    assert.equal(statusEvent?.payload.authorization, REDACTED_PLACEHOLDER);
  });

  it("bounded evidence cannot grow without limit", () => {
    const deep: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 40; i += 1) {
      const next: Record<string, unknown> = { value: "x".repeat(500) };
      cursor.child = next;
      cursor = next;
    }
    const out = sanitizeEvidence(deep);
    const size = new TextEncoder().encode(JSON.stringify(out)).length;
    assert.ok(size <= MAX_EVIDENCE_JSON_BYTES + 200);
  });

  it("persists without notification or agent infrastructure", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput());
    const loaded = await repo.findById(incident.id);
    assert.ok(loaded);
    assert.match(loaded.agentWorkCorrelationId, /^[0-9a-f-]{36}$/i);
    assert.equal(loaded.agentWorkLastSubmittedAt, null);
  });

  it("concurrent recordIncident for same dedupe_key keeps one incident", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:concurrency";
    const results = await Promise.all(
      Array.from({ length: 12 }, () => recordIncident(repo, baseInput({ dedupeKey }))),
    );
    assert.equal(repo.listIncidents().length, 1);
    const ids = new Set(results.map((r) => r.incident.id));
    assert.equal(ids.size, 1);
    const final = await repo.findByDedupeKey(dedupeKey);
    assert.equal(final?.occurrenceCount, 12);
    const occurrenceEvents = (await repo.listEvents(final!.id)).filter(
      (e) => e.eventType === "occurrence_recorded",
    );
    assert.equal(occurrenceEvents.length, 11);
  });

  it("does not mutate publication/content domain state", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(
      repo,
      baseInput({
        publicationId: "00a2327a-6137-41ea-b0b7-2b12340e8282",
        contentId: "64b86105-80dc-4eb1-bc30-325532b57508",
        batchId: "70193734-fd59-4ea7-a6bc-3463cf68d413",
      }),
    );
    assert.equal(incident.publicationId, "00a2327a-6137-41ea-b0b7-2b12340e8282");
    assert.equal(repo.listIncidents().length, 1);
  });

  it("increments incident_version on occurrence, transition, and resolution", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const { incident } = await recordIncident(repo, baseInput());
    assert.equal(incident.incidentVersion, 1);
    const afterOccurrence = await recordIncident(repo, baseInput({ dedupeKey: incident.dedupeKey }));
    assert.equal(afterOccurrence.incident.incidentVersion, 2);
    const investigating = await transitionIncidentStatus(
      repo,
      afterOccurrence.incident.id,
      "investigating",
    );
    assert.equal(investigating.incidentVersion, 3);
    const resolved = await resolveIncident(repo, afterOccurrence.incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "ok",
    });
    assert.equal(resolved.incidentVersion, 4);
  });

  it("agent_work_correlation_id is stable across occurrence and reopen", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:correlation";
    const first = await recordIncident(repo, baseInput({ dedupeKey }));
    const correlation = first.incident.agentWorkCorrelationId;
    const second = await recordIncident(repo, baseInput({ dedupeKey }));
    assert.equal(second.incident.agentWorkCorrelationId, correlation);
    await resolveIncident(repo, first.incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "done",
    });
    const reopened = await recordIncident(repo, baseInput({ dedupeKey }), { reopenIfResolved: true });
    assert.equal(reopened.incident.agentWorkCorrelationId, correlation);
  });

  it("preserves lifecycle and authorization on occurrence", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const dedupeKey = "test:preserve";
    const first = await recordIncident(
      repo,
      baseInput({
        dedupeKey,
        permittedActions: ["investigate_read_only"],
        retrySafety: "unsafe_duplicate_risk",
        humanApprovalRequired: true,
      }),
    );
    await transitionIncidentStatus(repo, first.incident.id, "action_required");
    const second = await recordIncident(repo, baseInput({ dedupeKey, errorMessage: "New message" }));
    assert.equal(second.incident.status, "action_required");
    assert.deepEqual(second.incident.permittedActions, ["investigate_read_only"]);
    assert.equal(second.incident.retrySafety, "unsafe_duplicate_risk");
    assert.equal(second.incident.humanApprovalRequired, true);
    assert.match(second.incident.sanitizedError, /Provider HTTP 503/);
  });
});
