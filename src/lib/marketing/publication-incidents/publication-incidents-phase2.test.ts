import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, test } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { setMarketingIncidentRepositoryForTests } from "../incidents/runtime-repository";
import type { MarketingNotificationPayload } from "../notifications/types";
import { applyAmbiguousPublicationOutcome } from "../publication-ambiguity/apply-outcome";
import {
  getAmbiguousOutcomeNotifyInvocationCountForTests,
  notifyPublicationAmbiguousOutcomeWithDeps,
  resetAmbiguousOutcomeNotifyInvocationCountForTests,
} from "../publication-ambiguity/notify";
import { MemoryMarketingStore } from "../memory-store";
import { retryAdminPublication } from "../publication-retry";
import type { MarketingPublication } from "../types";
import {
  PUBLICATION_OVERDUE_THRESHOLD_MS,
  PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
} from "../reliability/constants";
import { runReliabilityAlertPipeline } from "../reliability/sweep";
import { publicationAmbiguousIncidentDedupeKey } from "./dedupe-keys";
import { recordPublicationAmbiguousOutcomeIncident } from "./ambiguous";
import { recordPublicationRecoveryRequiredIncident } from "./recovery-required";

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

function failingIncidentRepository(): ReturnType<typeof createMemoryIncidentRepository> {
  const inner = createMemoryIncidentRepository();
  return {
    ...inner,
    async insertIncident() {
      throw new Error("simulated incident db failure");
    },
  };
}

describe("Phase II publication incidents", () => {
  it("A: ambiguous outcome records one incident with correct envelope and no retry authority", async () => {
    const repo = createMemoryIncidentRepository();
    resetAmbiguousOutcomeNotifyInvocationCountForTests();
    const pub = basePublication({ id: "pub-amb-1" });
    await recordPublicationAmbiguousOutcomeIncident(pub, {
      repository: repo,
    });

    const incidents = repo.listIncidents();
    assert.equal(incidents.length, 1);
    const incident = incidents[0]!;
    assert.equal(incident.incidentType, "publication_ambiguous");
    assert.equal(incident.status, "action_required");
    assert.equal(incident.retrySafety, "unknown_requires_verification");
    assert.deepEqual(incident.permittedActions, [
      "investigate_read_only",
      "owner_approve_remediation",
    ]);
    assert.equal(
      incident.dedupeKey,
      publicationAmbiguousIncidentDedupeKey("pub-amb-1"),
    );
    assert.ok(!incident.permittedActions.includes("admin_retry_publication"));
    assert.ok(!incident.permittedActions.includes("cron_retry_publication"));
    assert.equal(getAmbiguousOutcomeNotifyInvocationCountForTests(), 1);
  });

  it("A: applyAmbiguousPublicationOutcome records incident and notifies", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    resetAmbiguousOutcomeNotifyInvocationCountForTests();
    const store = new MemoryMarketingStore();
    const pub = await store.createPublication(
      basePublication({
        id: "pub-apply-amb",
        status: "scheduled",
        ambiguityState: "none",
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    assert.ok(claimed?.claimToken);

    await applyAmbiguousPublicationOutcome(store, {
      publication: claimed!,
      claimToken: claimed!.claimToken!,
      attemptCount: 1,
      lastError: "meta_http_error: timeout",
    });

    const updated = await store.getPublication(pub.id);
    assert.equal(updated?.ambiguityState, "ambiguous");
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(getAmbiguousOutcomeNotifyInvocationCountForTests(), 1);
    setMarketingIncidentRepositoryForTests(null);
  });

  it("B: stuck processing records incident without mutating publication; repeat sweep increments occurrence", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const pub = await store.createPublication(
      basePublication({
        id: "pub-stuck",
        status: "processing",
        ambiguityState: "none",
        updatedAt: new Date(Date.now() - PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS).toISOString(),
      }),
    );
    const before = await store.getPublication(pub.id);

    const claimed = new Set<string>();
    let notifyCount = 0;
    const deps = {
      claimDedupe: async ({ dedupeKey }: { dedupeKey: string }) => {
        if (claimed.has(dedupeKey)) return false;
        claimed.add(dedupeKey);
        return true;
      },
      notify: async () => {
        notifyCount += 1;
        return { notificationId: crypto.randomUUID() };
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    };

    await runReliabilityAlertPipeline({ overdue: [], stuck: [before!] }, deps);
    await runReliabilityAlertPipeline({ overdue: [], stuck: [before!] }, deps);

    const after = await store.getPublication(pub.id);
    assert.deepEqual(
      { status: after?.status, attemptCount: after?.attemptCount },
      { status: before?.status, attemptCount: before?.attemptCount },
    );
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(repo.listIncidents()[0]?.occurrenceCount, 2);
    assert.equal(notifyCount, 1);
    setMarketingIncidentRepositoryForTests(null);
  });

  it("C: overdue incident created without publish/retry; recurrence dedupes", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const pub = basePublication({
      id: "pub-overdue",
      status: "scheduled",
      ambiguityState: "none",
      scheduledFor: new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
    });

    await runReliabilityAlertPipeline(
      { overdue: [pub], stuck: [] },
      {
        claimDedupe: async () => true,
        notify: async () => ({ notificationId: "n1" }),
        attachDedupe: async () => {},
        releaseDedupe: async () => {},
      },
    );
    await runReliabilityAlertPipeline(
      { overdue: [pub], stuck: [] },
      {
        claimDedupe: async () => false,
        notify: async () => ({ notificationId: "n2" }),
        attachDedupe: async () => {},
        releaseDedupe: async () => {},
      },
    );

    const incident = repo.listIncidents()[0]!;
    assert.equal(incident.incidentType, "publication_overdue");
    assert.equal(incident.status, "open");
    assert.equal(incident.retrySafety, "not_applicable");
    assert.equal(incident.occurrenceCount, 2);
    setMarketingIncidentRepositoryForTests(null);
  });

  it("D: recovery required incident on admin retry 409 with unsafe_duplicate_risk", async () => {
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const pub = basePublication({
      id: "pub-recovery",
      platform: "instagram",
      status: "failed",
      externalId: null,
      providerCreationId: "18104922968283771",
    });
    await store.createPublication(pub);

    setMarketingIncidentRepositoryForTests(repo);
    const result = await retryAdminPublication(store, pub.id);
    setMarketingIncidentRepositoryForTests(null);

    assert.equal(result.status, 409);
    assert.equal(result.body.error?.code, "publication_recovery_required");
    const incident = repo.listIncidents()[0]!;
    assert.equal(incident.incidentType, "publication_recovery_required");
    assert.equal(incident.retrySafety, "unsafe_duplicate_risk");
    assert.ok(!incident.permittedActions.includes("schedule_reschedule"));
  });

  it("E: incident persistence failure still allows ambiguous notification", async () => {
    const failingRepo = failingIncidentRepository();
    resetAmbiguousOutcomeNotifyInvocationCountForTests();
    const pub = basePublication({ id: "pub-fail-db" });

    await recordPublicationAmbiguousOutcomeIncident(pub, {
      repository: failingRepo,
    });

    assert.equal(failingRepo.listIncidents().length, 0);
    assert.equal(getAmbiguousOutcomeNotifyInvocationCountForTests(), 1);
  });

  it("E2: sweep continues notifying subsequent items when incident recording fails", async () => {
    setMarketingIncidentRepositoryForTests(failingIncidentRepository());
    let notifyCount = 0;
    const pubs = ["pub-o1", "pub-o2"].map((id) =>
      basePublication({
        id,
        status: "scheduled",
        ambiguityState: "none",
        scheduledFor: new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
      }),
    );
    await runReliabilityAlertPipeline(
      { overdue: pubs, stuck: [] },
      {
        claimDedupe: async () => true,
        notify: async () => {
          notifyCount += 1;
          return { notificationId: crypto.randomUUID() };
        },
        attachDedupe: async () => {},
        releaseDedupe: async () => {},
      },
    );
    setMarketingIncidentRepositoryForTests(null);
    assert.equal(notifyCount, 2);
  });

  it("E3: recovery guard still returns 409 when incident recording fails", async () => {
    const store = new MemoryMarketingStore();
    const pub = basePublication({
      id: "pub-recovery-fail-db",
      platform: "instagram",
      status: "failed",
      externalId: null,
      providerCreationId: "18104922968283771",
    });
    await store.createPublication(pub);
    setMarketingIncidentRepositoryForTests(failingIncidentRepository());
    const result = await retryAdminPublication(store, pub.id);
    setMarketingIncidentRepositoryForTests(null);
    assert.equal(result.status, 409);
    assert.equal(result.body.error?.code, "publication_recovery_required");
  });

  it("recurrence does not replace original permitted_actions envelope", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({ id: "pub-recur-env" });
    await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    const first = repo.listIncidents()[0]!;
    await recordPublicationAmbiguousOutcomeIncident(
      { ...pub, lastError: "totally_different_error: should not change envelope" },
      { repository: repo },
    );
    const second = repo.listIncidents()[0]!;
    assert.equal(second.occurrenceCount, 2);
    assert.deepEqual(second.permittedActions, first.permittedActions);
    assert.equal(second.retrySafety, first.retrySafety);
  });

  it("F: sanitization redacts credential-like material in evidence via record path", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({
      id: "pub-secret",
      lastError: "meta_http_error: Authorization Bearer secret-token-value",
    });
    await recordPublicationAmbiguousOutcomeIncident(pub, { repository: repo });
    const incident = repo.listIncidents()[0]!;
    const raw = JSON.stringify(incident.evidence) + incident.sanitizedError;
    assert.ok(!raw.includes("secret-token-value"));
    assert.ok(!raw.includes("Bearer"));
  });
});

test("G: runtime wiring uses Postgres repository factory, not memory store", () => {
  const runtimeSrc = readFileSync(
    fileURLToPath(new URL("../incidents/runtime-repository.ts", import.meta.url)),
    "utf8",
  );
  assert.match(runtimeSrc, /createPostgresIncidentRepository/);
  assert.doesNotMatch(runtimeSrc, /MemoryMarketingIncidentRepository|createMemoryIncidentRepository/);

  for (const rel of [
    "../publication-incidents/ambiguous.ts",
    "../reliability/sweep.ts",
    "../publication-retry.ts",
  ]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /createMemoryIncidentRepository|MemoryMarketingStore/);
  }
});
