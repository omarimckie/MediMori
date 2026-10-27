import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { resetIncidentDedupeLocksForTests } from "../incidents/dedupe-lock";
import { recordPublicationOverdueIncident } from "../publication-incidents/overdue";
import { recordPublicationStuckProcessingIncident } from "../publication-incidents/stuck-processing";
import { recordPublicationAmbiguousOutcomeIncident } from "../publication-incidents/ambiguous";
import { recordPublicationRecoveryRequiredIncident } from "../publication-incidents/recovery-required";
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

const IMMUTABLE_PUBLICATION_FIELDS = [
  "status",
  "scheduledFor",
  "attemptCount",
  "lastError",
  "ambiguityState",
  "claimToken",
  "processingStartedAt",
  "providerCreationId",
  "externalId",
  "updatedAt",
] as const;

function snapshotPublicationFields(pub: MarketingPublication) {
  const snap: Record<string, unknown> = {};
  for (const key of IMMUTABLE_PUBLICATION_FIELDS) {
    snap[key] = pub[key];
  }
  return snap;
}

function assertPublicationUnchanged(
  before: MarketingPublication,
  after: MarketingPublication,
) {
  assert.deepEqual(snapshotPublicationFields(before), snapshotPublicationFields(after));
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

describe("incident reconcile adversarial (memory)", () => {
  describe("overdue policy via reconciler", () => {
    it("H: clean failed with no blockers auto-resolves", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({ id: "ov-clean-failed" });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);
      const beforePub = { ...pub, status: "failed" as const, lastError: "err" };
      publications.set(pub.id, beforePub);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 1);
      assert.equal(
        repo.listIncidents().find((i) => i.incidentType === "publication_overdue")?.status,
        "resolved",
      );
    });

    it("I: future-rescheduled publication auto-resolves", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({ id: "ov-reschedule" });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);
      publications.set(pub.id, {
        ...pub,
        status: "scheduled",
        scheduledFor: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 1);
    });

    it("G: still-overdue scheduled remains unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({
        id: "ov-still-overdue",
        scheduledFor: new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS - 120_000).toISOString(),
      });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 0);
      assert.equal(stats.skippedPolicy, 1);
    });

    it("F: scheduled without scheduled_for remains unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({ id: "ov-null-sched", scheduledFor: null });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 0);
      assert.equal(stats.skippedPolicy, 1);
    });

    it("A: failed + ambiguity_state blocks auto-resolve", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({
        id: "ov-failed-amb",
        status: "failed",
        ambiguityState: "ambiguous",
      });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(basePublication({ id: pub.id }), repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 0);
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("B: failed + provider_creation_id without external_id blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({
        id: "ov-failed-prov",
        status: "failed",
        providerCreationId: "18104922968283771",
        externalId: null,
      });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(basePublication({ id: pub.id }), repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("C: failed + inflight sentinel blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({
        id: "ov-failed-inflight",
        status: "failed",
        providerCreationId: "__publish_inflight__",
      });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(basePublication({ id: pub.id }), repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("D: unresolved publication_ambiguous incident blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({ id: "ov-block-amb-inc" });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);
      await recordPublicationAmbiguousOutcomeIncident(
        { ...pub, status: "failed", ambiguityState: "ambiguous" },
        { repository: repo },
      );
      publications.set(pub.id, { ...pub, status: "published" });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("E: unresolved publication_recovery_required incident blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({
        id: "ov-block-rec-inc",
        status: "failed",
        providerCreationId: "18104922968283771",
        externalId: null,
      });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(basePublication({ id: pub.id }), repo);
      await recordPublicationRecoveryRequiredIncident(pub, "test", repo);
      publications.set(pub.id, { ...pub, status: "published", ambiguityState: "none" });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("resolved manual incidents do not block eligible overdue auto-resolve", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({ id: "ov-resolved-manual-ok" });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);
      const amb = await recordPublicationAmbiguousOutcomeIncident(
        { ...pub, status: "failed", ambiguityState: "ambiguous" },
        { repository: repo },
      );
      assert.ok(amb);
      await resolveIncident(repo, amb.id, {
        resolutionType: "false_positive",
        resolutionSummary: "Historical.",
        incidentVersion: amb.incidentVersion,
      });
      publications.set(pub.id, { ...pub, status: "published" });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 1);
    });

    it("publication fields unchanged on successful overdue auto-resolve", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = basePublication({ id: "ov-immutable" });
      publications.set(pub.id, pub);
      await recordPublicationOverdueIncident(pub, repo);
      const afterState = {
        ...pub,
        status: "published" as const,
        publishedAt: new Date().toISOString(),
        externalId: "ext-1",
        attemptCount: 2,
        updatedAt: new Date().toISOString(),
      };
      publications.set(pub.id, afterState);
      const beforeSnap = { ...afterState };

      await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assertPublicationUnchanged(beforeSnap, publications.get(pub.id)!);
    });
  });

  describe("stuck processing churn via reconciler", () => {
    function stuckProcessingPub(
      id: string,
      patch: Partial<MarketingPublication> = {},
    ): MarketingPublication {
      return basePublication({
        id,
        status: "processing",
        updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        processingStartedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        claimToken: "claim-old",
        ...patch,
      });
    }

    async function assertStillProcessingUnresolved(
      publications: Map<string, MarketingPublication>,
      pub: MarketingPublication,
      repo: ReturnType<typeof createMemoryIncidentRepository>,
      store: MemoryMarketingStore,
    ) {
      const initial = stuckProcessingPub(pub.id);
      await recordPublicationStuckProcessingIncident(initial, repo);
      publications.set(pub.id, pub);
      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.autoResolved, 0);
      assert.ok(stats.skippedPolicy + stats.skippedUnsafe >= 1);
    }

    it("A: fresh updated_at while processing stays unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const id = "st-fresh-updated";
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub(id, { updatedAt: new Date().toISOString() }),
        repo,
        store,
      );
    });

    it("B: processing_started_at changes while processing stays unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub("st-psp-change", {
          processingStartedAt: new Date().toISOString(),
        }),
        repo,
        store,
      );
    });

    it("C: claim_token changes while processing stays unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub("st-claim-change", { claimToken: "claim-new" }),
        repo,
        store,
      );
    });

    it("D: claim_token null while processing stays unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub("st-claim-null", { claimToken: null }),
        repo,
        store,
      );
    });

    it("E: processing_started_at null while processing stays unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub("st-psp-null", { processingStartedAt: null }),
        repo,
        store,
      );
    });

    it("F: newer claim + fresh updated_at together stay unresolved", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub("st-churn-combo", {
          claimToken: "claim-newest",
          updatedAt: new Date().toISOString(),
          processingStartedAt: new Date().toISOString(),
        }),
        repo,
        store,
      );
    });

    it("G: ambiguity_state while processing blocks auto-resolve", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      await assertStillProcessingUnresolved(
        publications,
        stuckProcessingPub("st-amb-row", {
          ambiguityState: "ambiguous",
          updatedAt: new Date().toISOString(),
        }),
        repo,
        store,
      );
    });

    it("H: provider_creation_id recovery signal blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-prov-rec", {
        providerCreationId: "18104922968283771",
      });
      publications.set(pub.id, { ...pub, status: "failed", externalId: null });
      await recordPublicationStuckProcessingIncident(pub, repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("I: inflight sentinel blocks stuck path", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-inflight", {
        providerCreationId: "__publish_inflight__",
      });
      publications.set(pub.id, { ...pub, status: "failed" });
      await recordPublicationStuckProcessingIncident(pub, repo);

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("J: unresolved ambiguous incident blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-block-amb");
      publications.set(pub.id, pub);
      await recordPublicationStuckProcessingIncident(pub, repo);
      await recordPublicationAmbiguousOutcomeIncident(
        { ...pub, status: "failed", ambiguityState: "ambiguous" },
        { repository: repo },
      );
      publications.set(pub.id, { ...pub, status: "published" });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("K: unresolved recovery_required incident blocks", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-block-rec", {
        providerCreationId: "18104922968283771",
        externalId: null,
      });
      publications.set(pub.id, pub);
      await recordPublicationStuckProcessingIncident(pub, repo);
      await recordPublicationRecoveryRequiredIncident(
        { ...pub, status: "failed" },
        "test",
        repo,
      );
      publications.set(pub.id, { ...pub, status: "published", ambiguityState: "none" });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.skippedUnsafe, 1);
    });

    it("L: processing to published auto-resolves", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-to-published");
      publications.set(pub.id, pub);
      await recordPublicationStuckProcessingIncident(pub, repo);
      publications.set(pub.id, { ...pub, status: "published", publishedAt: new Date().toISOString() });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.stuckAutoResolved, 1);
    });

    it("M: clean processing to failed auto-resolves", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-to-failed");
      publications.set(pub.id, pub);
      await recordPublicationStuckProcessingIncident(pub, repo);
      publications.set(pub.id, { ...pub, status: "failed", lastError: "timeout" });

      const stats = await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assert.equal(stats.stuckAutoResolved, 1);
    });

    it("publication fields unchanged on successful stuck auto-resolve", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub = stuckProcessingPub("st-immutable");
      publications.set(pub.id, pub);
      await recordPublicationStuckProcessingIncident(pub, repo);
      const failed = {
        ...pub,
        status: "failed" as const,
        lastError: "x",
        attemptCount: 3,
        updatedAt: new Date().toISOString(),
      };
      publications.set(pub.id, failed);
      const beforeSnap = { ...failed };

      await reconcileAutoResolvableIncidents(memoryDeps(repo, store, publications));
      assertPublicationUnchanged(beforeSnap, publications.get(pub.id)!);
    });
  });

  describe("reconciler per-item failure isolation", () => {
    it("continues when publication lookup throws", async () => {
      resetIncidentDedupeLocksForTests();
      const repo = createMemoryIncidentRepository();
      const store = new MemoryMarketingStore();
      const publications = new Map<string, MarketingPublication>();
      const pub1 = basePublication({ id: "iso-lookup-fail" });
      const pub2 = basePublication({ id: "iso-lookup-ok" });
      publications.set(pub2.id, pub2);
      await recordPublicationOverdueIncident(pub1, repo);
      await recordPublicationOverdueIncident(pub2, repo);
      publications.set(pub2.id, { ...pub2, status: "published" });

      const base = memoryDeps(repo, store, publications);
      const deps: IncidentReconcileDeps = {
        ...base,
        getPublication: async (id) => {
          if (id === pub1.id) {
            throw new Error("lookup_failed");
          }
          return publications.get(id) ?? null;
        },
      };
      const stats = await reconcileAutoResolvableIncidents(deps);
      assert.equal(stats.failed, 1);
      assert.equal(stats.autoResolved, 1);
    });
  });
});
