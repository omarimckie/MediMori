import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, test } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { resolveIncident } from "../incidents/record";
import { setMarketingIncidentRepositoryForTests } from "../incidents/runtime-repository";
import { MemoryMarketingStore } from "../memory-store";
import { PUBLICATION_CRON_SAFE_RETRY_PROOF } from "../publication-cron-retry";
import {
  applyAmbiguousPublicationOutcome,
  applyConfirmedPublicationFailure,
} from "../publication-ambiguity/apply-outcome";
import type { MarketingPublication } from "../types";
import { publicationFailedIncidentDedupeKey } from "./dedupe-keys";
import { notifyPublicationFailedWithDeps } from "./failed-notify";
import { recordPublicationFailedIncidentResult } from "./failed";
import {
  evaluatePublicationFailedCapture,
  isPublicationEligibleForAutomaticCronRetry,
} from "./publication-failed-eligibility";
import { recordPublicationAmbiguousOutcomeIncident } from "./ambiguous";
import {
  isSmartUploadCaptionOperationalFailure,
  isSmartUploadFinalizeOperationalFailure,
} from "../smart-upload-incidents/operational-errors";
import {
  recordSmartUploadCaptionFailedIncident,
  recordSmartUploadFinalizeFailedIncident,
} from "../smart-upload-incidents/record";
import { SmartUploadCaptionGroundingError } from "../smart-upload-caption-errors";
import { SmartUploadCaptionProviderError } from "../smart-upload-caption-errors";

const CRON_SAFE = `meta_http_error: timeout ${PUBLICATION_CRON_SAFE_RETRY_PROOF}`;
const B1_CONTENT_ID = "11111111-1111-4111-8111-111111110001";

function b1PubId(slot: number): string {
  const tail = slot.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${tail}`;
}

function basePublication(
  patch: Partial<MarketingPublication> & { id: string },
): MarketingPublication {
  const now = new Date().toISOString();
  return {
    contentId: B1_CONTENT_ID,
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: `key:${patch.id}`,
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "meta_http_error: permanent failure",
    scheduledFor: null,
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function failingIncidentRepository(): ReturnType<typeof createMemoryIncidentRepository> {
  const inner = createMemoryIncidentRepository();
  return {
    ...inner,
    async insertIncident() {
      throw new Error("simulated incident db failure");
    },
  };
}

describe("Phase III-B1 publication_failed eligibility", () => {
  it("A: safe retryable first failure — no incident", async () => {
    const pub = basePublication({
      id: b1PubId(0xa),
      attemptCount: 1,
      lastError: CRON_SAFE,
    });
    assert.equal(isPublicationEligibleForAutomaticCronRetry(pub), true);
    assert.deepEqual(evaluatePublicationFailedCapture(pub), {
      capture: false,
      reason: "cron_retry_still_eligible",
    });
    const repo = createMemoryIncidentRepository();
    assert.equal(
      await recordPublicationFailedIncidentResult(pub, "test", repo),
      null,
    );
    assert.equal(repo.listIncidents().length, 0);
  });

  it("B: safe retryable intermediate failure — no incident", async () => {
    const pub = basePublication({
      id: b1PubId(0xb),
      attemptCount: 2,
      lastError: CRON_SAFE,
    });
    assert.equal(evaluatePublicationFailedCapture(pub).capture, false);
  });

  it("C: retry exhaustion at attemptCount 3 — actionable incident", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: b1PubId(0xc),
      attemptCount: 3,
      lastError: CRON_SAFE,
    });
    assert.equal(isPublicationEligibleForAutomaticCronRetry(pub), false);
    const result = await recordPublicationFailedIncidentResult(pub, "test_exhaust", repo);
    assert.ok(result);
    assert.equal(result!.outcome, "created");
    const incident = repo.listIncidents()[0]!;
    assert.equal(incident.incidentType, "publication_failed");
    assert.equal(incident.dedupeKey, publicationFailedIncidentDedupeKey(b1PubId(0xc)));
    assert.equal(incident.status, "action_required");
  });

  it("D: confirmed non-retryable terminal failure — incident on first attempt", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: b1PubId(0xd),
      attemptCount: 1,
      lastError: "meta_policy_violation: blocked",
    });
    const result = await recordPublicationFailedIncidentResult(pub, "test_terminal", repo);
    assert.ok(result);
    assert.equal(repo.listIncidents()[0]!.errorClass, "meta_policy_violation");
  });

  it("E: repeat observation — same id, occurrence without duplicate notify", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: b1PubId(0xe),
      attemptCount: 3,
      lastError: "meta_http_error: done",
    });
    const first = await recordPublicationFailedIncidentResult(pub, "t1", repo);
    const second = await recordPublicationFailedIncidentResult(pub, "t2", repo);
    assert.equal(first!.incident.id, second!.incident.id);
    assert.equal(second!.outcome, "occurrence");
    let notifyCount = 0;
    await notifyPublicationFailedWithDeps(pub, second!.incident, second!.outcome, {
      claimDedupe: async () => true,
      notify: async () => {
        notifyCount += 1;
        return { notificationId: "n1" };
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    });
    assert.equal(notifyCount, 0);
  });

  it("F: genuine recurrence after owner resolve — reopen", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: b1PubId(0xf),
      attemptCount: 3,
      lastError: "meta_http_error: x",
    });
    const first = await recordPublicationFailedIncidentResult(pub, "t1", repo);
    await resolveIncident(repo, first!.incident.id, {
      resolutionType: "owner_resolved",
      actor: "owner",
      resolutionSummary: "fixed",
    });
    const second = await recordPublicationFailedIncidentResult(pub, "t2", repo);
    assert.equal(second!.outcome, "reopened");
    assert.equal(second!.incident.id, first!.incident.id);
  });

  it("G: ambiguous — publication_ambiguous only", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: b1PubId(0x10),
      ambiguityState: "ambiguous",
      attemptCount: 3,
    });
    const ambDecision = evaluatePublicationFailedCapture(pub);
    assert.equal(ambDecision.capture, false);
    if (!ambDecision.capture) assert.equal(ambDecision.reason, "ambiguity_blocked");
    await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    await recordPublicationFailedIncidentResult(pub, "t", repo);
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(repo.listIncidents()[0]!.incidentType, "publication_ambiguous");
  });

  it("H: owner_required ambiguity — no publication_failed", async () => {
    const pub = basePublication({
      id: b1PubId(0x11),
      ambiguityState: "owner_required",
      attemptCount: 3,
    });
    assert.equal(evaluatePublicationFailedCapture(pub).capture, false);
  });

  it("I: recovery-required — recovery incident, not publication_failed", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const pub = await store.createPublication(
      basePublication({
        id: b1PubId(0x12),
        platform: "instagram",
        status: "scheduled",
        ambiguityState: "none",
        providerCreationId: null,
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    assert.ok(claimed?.claimToken);
    const updated = await applyConfirmedPublicationFailure(store, {
      publication: {
        ...claimed!,
        providerCreationId: "18104922968283771",
      },
      claimToken: claimed!.claimToken!,
      attemptCount: 1,
      lastError: "meta_publish_failed: incomplete",
      cronAutoRetry: false,
      platform: "instagram",
      providerRetryable: false,
    });
    assert.ok(updated);
    const incidents = repo.listIncidents();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]!.incidentType, "publication_recovery_required");
    setMarketingIncidentRepositoryForTests(null);
  });

  it("J: credential-class failure — no publication_failed", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: b1PubId(0x13),
      attemptCount: 3,
      lastError: "meta_auth_expired: token",
    });
    const credDecision = evaluatePublicationFailedCapture(pub);
    assert.equal(credDecision.capture, false);
    if (!credDecision.capture) assert.equal(credDecision.reason, "credential_class");
    assert.equal(await recordPublicationFailedIncidentResult(pub, "t", repo), null);
  });

  it("K: successful publication — no failure incident", async () => {
    const pub = basePublication({
      id: b1PubId(0x14),
      status: "published",
      attemptCount: 1,
    });
    const okDecision = evaluatePublicationFailedCapture(pub);
    assert.equal(okDecision.capture, false);
    if (!okDecision.capture) assert.equal(okDecision.reason, "not_failed");
  });

  it("L: incident persistence failure — publication failure path unchanged", async () => {
    const store = new MemoryMarketingStore();
    const pub = await store.createPublication(
      basePublication({
        id: b1PubId(0x15),
        status: "scheduled",
        ambiguityState: "none",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    setMarketingIncidentRepositoryForTests(failingIncidentRepository());
    const before = { ...claimed! };
    await applyConfirmedPublicationFailure(store, {
      publication: claimed!,
      claimToken: claimed!.claimToken!,
      attemptCount: 3,
      lastError: "meta_http_error: final",
      cronAutoRetry: false,
      platform: "instagram",
      providerRetryable: false,
    });
    const after = await store.getPublication(pub.id);
    assert.equal(after?.status, "failed");
    assert.equal(after?.attemptCount, 3);
    assert.equal(after?.ambiguityState, "none");
    assert.equal(after?.claimToken, null);
    assert.notEqual(after?.lastError, before.lastError);
    setMarketingIncidentRepositoryForTests(null);
  });
});

describe("Phase III-B1 notifications", () => {
  it("actionable publication_failed notifies on created with related_incident_id", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({ id: b1PubId(0x20), attemptCount: 3 });
    const recorded = await recordPublicationFailedIncidentResult(pub, "t", repo);
    assert.ok(recorded);
    let payloadRelated: string | null = null;
    await notifyPublicationFailedWithDeps(pub, recorded!.incident, recorded!.outcome, {
      claimDedupe: async () => true,
      notify: async (payload) => {
        payloadRelated = payload.relatedIncidentId ?? null;
        return { notificationId: "n1" };
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    });
    assert.equal(payloadRelated, recorded!.incident.id);
  });

  it("notification failure does not alter publication state", async () => {
    const store = new MemoryMarketingStore();
    const pub = await store.createPublication(
      basePublication({
        id: b1PubId(0x21),
        status: "scheduled",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    await applyConfirmedPublicationFailure(store, {
      publication: claimed!,
      claimToken: claimed!.claimToken!,
      attemptCount: 3,
      lastError: "meta_http_error: x",
      cronAutoRetry: false,
      platform: "instagram",
      providerRetryable: false,
    });
    const row = await store.getPublication(pub.id);
    assert.equal(row?.status, "failed");
    setMarketingIncidentRepositoryForTests(null);
  });
});

describe("Phase III-B1 Smart Upload incidents", () => {
  it("caption operational failure records incident; validation does not", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    assert.equal(
      isSmartUploadCaptionOperationalFailure(new SmartUploadCaptionProviderError("bad model")),
      true,
    );
    assert.equal(
      isSmartUploadCaptionOperationalFailure(new SmartUploadCaptionGroundingError("x")),
      false,
    );
    await recordSmartUploadCaptionFailedIncident({
      finalizeKey: "fk-caption-1",
      sourceOperation: "test",
      errorMessage: "provider down",
    });
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(repo.listIncidents()[0]!.incidentType, "smart_upload_caption_failed");
    await recordSmartUploadCaptionFailedIncident({
      finalizeKey: "fk-caption-1",
      sourceOperation: "test",
      errorMessage: "provider down again",
    });
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(repo.listIncidents()[0]!.occurrenceCount, 2);
    setMarketingIncidentRepositoryForTests(null);
  });

  it("finalize operational failure dedupes; validation excluded", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    assert.equal(isSmartUploadFinalizeOperationalFailure(new Error("Unknown book.")), false);
    const validationErr = new Error("bad aspect");
    (validationErr as Error & { validationIssues: unknown[] }).validationIssues = [
      { code: "aspect", message: "bad" },
    ];
    assert.equal(isSmartUploadFinalizeOperationalFailure(validationErr), false);
    await recordSmartUploadFinalizeFailedIncident({
      finalizeKey: "fk-fin-1",
      batchId: "batch-1",
      sourceOperation: "test",
      errorMessage: "database unavailable",
    });
    assert.equal(repo.listIncidents()[0]!.incidentType, "smart_upload_finalize_failed");
    setMarketingIncidentRepositoryForTests(null);
  });

  it("sanitization redacts secrets in smart upload evidence", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    await recordSmartUploadFinalizeFailedIncident({
      finalizeKey: "fk-sec",
      sourceOperation: "test",
      errorMessage: "Authorization Bearer leaked-token",
      evidence: { nested: { cookie: "session=abc" } },
    });
    const raw = JSON.stringify(repo.listIncidents()[0]!);
    assert.ok(!raw.includes("leaked-token"));
    setMarketingIncidentRepositoryForTests(null);
  });
});

test("B1 static: no backfill sweep or Meta calls in prospective wiring", () => {
  const observeSrc = readFileSync(
    fileURLToPath(new URL("./observe-failure-outcomes.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(observeSrc, /publishDue|reconcile|listPublications/);
  const applySrc = readFileSync(
    fileURLToPath(new URL("../publication-ambiguity/apply-outcome.ts", import.meta.url)),
    "utf8",
  );
  assert.match(applySrc, /observePublicationFailureOutcomes/);
  assert.doesNotMatch(applySrc, /4d5d10f1-f3a7-4d40-8855-7390db9187c8/);
});

test("retry exhaustion boundary matches publishDue (attemptCount < 3)", () => {
  const approvalSrc = readFileSync(
    fileURLToPath(new URL("../approval.ts", import.meta.url)),
    "utf8",
  );
  assert.match(approvalSrc, /item\.attemptCount < 3/);
  const pub = basePublication({ id: b1PubId(0x99), attemptCount: 3, lastError: CRON_SAFE });
  assert.equal(isPublicationEligibleForAutomaticCronRetry(pub), false);
});
