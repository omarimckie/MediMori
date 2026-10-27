import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { resetIncidentDedupeLocksForTests } from "../incidents/dedupe-lock";
import { recordPublicationOverdueIncident } from "../publication-incidents/overdue";
import { recordPublicationStuckProcessingIncident } from "../publication-incidents/stuck-processing";
import { recordPublicationAmbiguousOutcomeIncident } from "../publication-incidents/ambiguous";
import { MemoryMarketingStore } from "../memory-store";
import type { MarketingPublication } from "../types";
import { PUBLICATION_OVERDUE_THRESHOLD_MS } from "./constants";
import {
  AUTO_RESOLVE_INCIDENT_TYPES,
  reconcileAutoResolvableIncidents,
  type IncidentReconcileDeps,
} from "./incident-reconcile";
import { resolveIncident } from "../incidents/record";

function basePublication(
  patch: Partial<MarketingPublication> & { id: string },
): MarketingPublication {
  const now = new Date().toISOString();
  return {
    contentId: "content-1",
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: `k:${patch.id}`,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
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

function memoryDeps(
  repo: ReturnType<typeof createMemoryIncidentRepository>,
  store: MemoryMarketingStore,
  publications: Map<string, MarketingPublication>,
): IncidentReconcileDeps {
  return {
    repository: repo,
    listCandidates: async (limit) =>
      repo
        .listIncidents()
        .filter(
          (i) =>
            i.status !== "resolved" &&
            AUTO_RESOLVE_INCIDENT_TYPES.includes(i.incidentType) &&
            i.publicationId,
        )
        .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
        .slice(0, limit),
    getPublication: async (id) => publications.get(id) ?? null,
    manualBlockerPublicationIds: async (ids) => {
      const blocked = new Set<string>();
      for (const inc of repo.listIncidents()) {
        if (
          inc.status !== "resolved" &&
          (inc.incidentType === "publication_ambiguous" ||
            inc.incidentType === "publication_recovery_required") &&
          inc.publicationId &&
          ids.includes(inc.publicationId)
        ) {
          blocked.add(inc.publicationId);
        }
      }
      return blocked;
    },
  };
}

describe("incident reconcile (memory)", () => {
  it("auto-resolves overdue after publication published", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({ id: "pub-overdue-resolve" });
    publications.set(pub.id, pub);
    await store.createPublication(pub);
    await recordPublicationOverdueIncident(pub, repo);
    publications.set(pub.id, { ...pub, status: "published", publishedAt: new Date().toISOString() });
    await store.updatePublication(pub.id, {
      status: "published",
      publishedAt: new Date().toISOString(),
    });

    const before = JSON.stringify(await store.getPublication(pub.id));
    const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    const after = JSON.stringify(await store.getPublication(pub.id));
    assert.equal(before, after);
    assert.equal(stats.autoResolved, 1);
    assert.equal(repo.listIncidents()[0]?.status, "resolved");
    assert.equal(repo.listIncidents()[0]?.resolutionType, "auto_recovered");
  });

  it("skips overdue when manual ambiguity incident exists", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({ id: "pub-blocked-amb", ambiguityState: "none" });
    publications.set(pub.id, pub);
    await store.createPublication(pub);
    await recordPublicationOverdueIncident(pub, repo);
    await recordPublicationAmbiguousOutcomeIncident(
      { ...pub, status: "failed", ambiguityState: "ambiguous" },
      { repository: repo },
    );
    publications.set(pub.id, { ...pub, status: "published" });

    const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    assert.equal(stats.autoResolved, 0);
    assert.equal(stats.skippedUnsafe, 1);
    assert.equal(repo.listIncidents().find((i) => i.incidentType === "publication_overdue")?.status, "open");
  });

  it("skips stuck while still processing even with fresh updated_at", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({
      id: "pub-stuck-still",
      status: "processing",
      updatedAt: new Date().toISOString(),
      processingStartedAt: new Date().toISOString(),
    });
    publications.set(pub.id, pub);
    await recordPublicationStuckProcessingIncident(pub, repo);

    const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    assert.equal(stats.autoResolved, 0);
    assert.equal(stats.skippedPolicy, 1);
  });

  it("auto-resolves stuck after publication failed cleanly", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({
      id: "pub-stuck-failed",
      status: "processing",
      updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    publications.set(pub.id, pub);
    await recordPublicationStuckProcessingIncident(pub, repo);
    publications.set(pub.id, { ...pub, status: "failed", lastError: "timeout" });

    const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    assert.equal(stats.autoResolved, 1);
    assert.equal(repo.listIncidents()[0]?.resolutionType, "auto_recovered");
  });

  it("skips missing publication", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({ id: "pub-missing" });
    await recordPublicationOverdueIncident(pub, repo);

    const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    assert.equal(stats.skippedMissingPublication, 1);
  });

  it("recurrence reopens same incident id after auto-resolution", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({ id: "pub-reopen-auto" });
    publications.set(pub.id, pub);
    const first = await recordPublicationOverdueIncident(pub, repo);
    assert.ok(first);
    publications.set(pub.id, { ...pub, status: "published" });
    await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    publications.set(pub.id, basePublication({ id: "pub-reopen-auto" }));
    const reopened = await recordPublicationOverdueIncident(publications.get(pub.id)!, repo);
    assert.ok(reopened);
    assert.equal(reopened.id, first.id);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.occurrenceCount, 2);
  });

  it("skips auto-resolve when owner already resolved", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub = basePublication({ id: "pub-race" });
    publications.set(pub.id, pub);
    const incident = await recordPublicationOverdueIncident(pub, repo);
    assert.ok(incident);
    publications.set(pub.id, { ...pub, status: "published" });
    await resolveIncident(repo, incident.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "Owner closed first.",
      incidentVersion: incident.incidentVersion,
    });
    const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
    assert.equal(stats.autoResolved, 0);
    assert.equal(repo.listIncidents()[0]?.resolutionType, "owner_resolved");
  });

  it("continues after resolve failure on earlier candidate", async () => {
    resetIncidentDedupeLocksForTests();
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const publications = new Map<string, MarketingPublication>();
    const pub1 = basePublication({ id: "pub-fail-resolve" });
    const pub2 = basePublication({ id: "pub-ok-resolve" });
    publications.set(pub1.id, pub1);
    publications.set(pub2.id, pub2);
    const inc1 = await recordPublicationOverdueIncident(pub1, repo);
    const inc2 = await recordPublicationOverdueIncident(pub2, repo);
    assert.ok(inc1 && inc2);
    publications.set(pub1.id, { ...pub1, status: "published" });
    publications.set(pub2.id, { ...pub2, status: "published" });

    const deps = memoryDeps(repo, store, publications);
    const wrapped: IncidentReconcileDeps = {
      ...deps,
      repository: {
        findByDedupeKey: (key) => repo.findByDedupeKey(key),
        findById: (id) => repo.findById(id),
        insertIncident: (input) => repo.insertIncident(input),
        appendEvent: (input) => repo.appendEvent(input),
        listEvents: (id) => repo.listEvents(id),
        updateIncident(id, version, patch) {
          if (id === inc1.id) {
            return Promise.resolve(null);
          }
          return repo.updateIncident(id, version, patch);
        },
      },
    };

    const stats = await reconcileAutoResolvableIncidents(wrapped);
    assert.equal(stats.skippedConflict, 1);
    assert.equal(stats.autoResolved, 1);
  });
});
