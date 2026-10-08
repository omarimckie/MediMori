import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { recordIncident, resolveIncident } from "../incidents/record";
import { setMarketingIncidentRepositoryForTests } from "../incidents/runtime-repository";
import {
  setSendMarketingAdminBroadcastForTests,
  type SendMarketingAdminBroadcastInput,
  type SendMarketingAdminBroadcastResult,
} from "../notifications/broadcast";
import type { MarketingAdminNotificationRecord } from "../notifications/types";
import type { MarketingNotificationPayload } from "../notifications/types";
import { MemoryMarketingStore } from "../memory-store";
import { PUBLICATION_CRON_SAFE_RETRY_PROOF } from "../publication-cron-retry";
import type { MarketingContent, MarketingPublication, Platform } from "../types";
import {
  partialPublicationFailureIncidentDedupeKey,
  publicationFailedIncidentDedupeKey,
} from "./dedupe-keys";
import { recordPublicationFailedIncidentResult } from "./failed";
import { notifyPublicationFailedWithDeps } from "./failed-notify";
import { observePublicationFailureOutcomes } from "./observe-failure-outcomes";
import { canonicalPublicationIdempotencyKey } from "./partial-publication-pairing";
import {
  observePartialPublicationFailure,
  observePartialPublicationFailureForPublishedCounterpart,
  runPartialPublicationFailureBackupSweep,
} from "./partial-publication-failure";
import {
  resetPartialPublicationFailureEnabledAtForTests,
  setPartialPublicationFailureEnabledAtForTests,
  validatePartialPublicationFailureEnabledAt,
} from "./partial-publication-failure-config";
import type { RecordIncidentOutcome } from "../incidents/record-types";
import { runMarketingReliabilitySweep } from "../reliability/sweep";

const BATCH = "70193734-fd59-4ea7-a6bc-3463cf68d413";
const SCHEDULED = "2026-10-10T16:00:00.000Z";
const PROSPECTIVE_NOW = "2026-10-10T17:00:00.000Z";

function contentId(slot: string): string {
  return `cccccccc-cccc-4ccc-8ccc-${slot.padStart(12, "0")}`;
}

function pubId(slot: string): string {
  return `dddddddd-dddd-4ddd-8ddd-${slot.padStart(12, "0")}`;
}

function smartUploadContent(
  platform: Platform,
  id: string,
  status: MarketingContent["status"],
  batchId: string,
): MarketingContent {
  const now = PROSPECTIVE_NOW;
  return {
    id,
    campaignId: null,
    weeklyPlanId: null,
    platform,
    format: "post",
    category: "educational",
    audience: "parents",
    status,
    title: `${platform} post`,
    body: "body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: SCHEDULED,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {
      source: "smart_upload",
      batchId,
      smartUploadFinalizeKey: "finalize-key-1",
      originalAssetId: "asset-1",
    },
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}

function publicationRow(
  content: MarketingContent,
  id: string,
  status: MarketingPublication["status"],
  patch: Partial<MarketingPublication> = {},
): MarketingPublication {
  const now = PROSPECTIVE_NOW;
  return {
    id,
    contentId: content.id,
    campaignId: null,
    platform: content.platform,
    provider: content.platform,
    status,
    idempotencyKey: canonicalPublicationIdempotencyKey(content.id, content.platform),
    externalId: status === "published" ? `ext-${id}` : null,
    url: status === "published" ? `https://example.com/${id}` : null,
    attemptCount: status === "failed" ? 3 : 1,
    lastError: status === "failed" ? "meta_http_error: terminal failure" : null,
    scheduledFor: SCHEDULED,
    publishedAt: status === "published" ? PROSPECTIVE_NOW : null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function mockBroadcastResult(
  input: SendMarketingAdminBroadcastInput,
): SendMarketingAdminBroadcastResult {
  const notification: MarketingAdminNotificationRecord = {
    id: crypto.randomUUID(),
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body,
    destination: input.destination ?? "/admin/marketing/week",
    relatedContentId: input.relatedContentId ?? null,
    relatedPublicationId: input.relatedPublicationId ?? null,
    relatedIncidentId: input.relatedIncidentId ?? null,
    deliveryStatus: "skipped",
    deliveryAttemptedAt: null,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  return { notification, pushAttempted: 0, pushDelivered: 0 };
}

async function seedPair(
  store: MemoryMarketingStore,
  input: {
    fbContentStatus: MarketingContent["status"];
    igContentStatus: MarketingContent["status"];
    fbPub?: MarketingPublication["status"] | null;
    igPub?: MarketingPublication["status"] | null;
    fbPubPatch?: Partial<MarketingPublication>;
    igPubPatch?: Partial<MarketingPublication>;
    batchId?: string;
    igOnly?: boolean;
  },
) {
  const batchId = input.batchId ?? BATCH;
  const fbContent = smartUploadContent("facebook", contentId("000000000001"), input.fbContentStatus, batchId);
  const igContent = smartUploadContent("instagram", contentId("000000000002"), input.igContentStatus, batchId);
  await store.createContent(igContent);
  await store.createContent(fbContent);
  let fbPub: MarketingPublication | null = null;
  let igPub: MarketingPublication | null = null;
  if (input.fbPub && !input.igOnly) {
    fbPub = await store.createPublication(
      publicationRow(fbContent, pubId("000000000001"), input.fbPub, input.fbPubPatch),
    );
    await store.updatePublication(fbPub.id, {});
    fbPub = (await store.getPublication(fbPub.id))!;
  }
  if (input.igPub) {
    igPub = await store.createPublication(
      publicationRow(igContent, pubId("000000000002"), input.igPub, input.igPubPatch),
    );
    await store.updatePublication(igPub.id, {});
    igPub = (await store.getPublication(igPub.id))!;
  }
  return { fbContent, igContent, fbPub, igPub };
}

function hookProspective(
  outcome: RecordIncidentOutcome = "created",
  publicationFailedFirstSeenAt: string = PROSPECTIVE_NOW,
) {
  return {
    prospective: {
      kind: "hook_actionable_failure_transition" as const,
      publicationFailedOutcome: outcome,
      publicationFailedFirstSeenAt,
    },
  };
}

describe("Phase III-B2 partial publication failure", () => {
  let store: MemoryMarketingStore;
  let repo: ReturnType<typeof createMemoryIncidentRepository>;
  const notifyCalls: MarketingNotificationPayload[] = [];

  beforeEach(() => {
    store = new MemoryMarketingStore();
    repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    setPartialPublicationFailureEnabledAtForTests("2026-10-01T00:00:00.000Z");
    notifyCalls.length = 0;
    setSendMarketingAdminBroadcastForTests(async (input: SendMarketingAdminBroadcastInput) => {
      notifyCalls.push(input);
      return mockBroadcastResult(input);
    });
  });

  afterEach(() => {
    setMarketingIncidentRepositoryForTests(null);
    resetPartialPublicationFailureEnabledAtForTests();
    setSendMarketingAdminBroadcastForTests(null);
  });

  it("valid FB published / IG actionable failed", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const incident = await observePartialPublicationFailure(store, igPub!.id, "test", {
      ...hookProspective(),
      repository: repo,
    });
    assert.ok(incident);
    assert.equal(incident!.incidentType, "partial_publication_failure");
    assert.equal(
      incident!.dedupeKey,
      partialPublicationFailureIncidentDedupeKey(BATCH, igPub!.id),
    );
    assert.equal(incident!.publicationId, igPub!.id);
    assert.equal(incident!.batchId, BATCH);
    assert.ok(incident!.evidence.counterpart_publication_id);
  });

  it("reverse platform order (IG published, FB failed)", async () => {
    const { fbPub } = await seedPair(store, {
      fbContentStatus: "failed",
      igContentStatus: "published",
      fbPub: "failed",
      igPub: "published",
    });
    const incident = await observePartialPublicationFailure(store, fbPub!.id, "test", { ...hookProspective(), repository: repo });
    assert.ok(incident);
    assert.equal(incident!.platform, "facebook");
  });

  it("both published — no partial", async () => {
    const { fbPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "published",
      fbPub: "published",
      igPub: "published",
    });
    assert.equal(await observePartialPublicationFailure(store, fbPub!.id, "test", { ...hookProspective(), repository: repo }), null);
    assert.equal(repo.listIncidents().length, 0);
  });

  it("both failed — no partial", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "failed",
      igContentStatus: "failed",
      fbPub: "failed",
      igPub: "failed",
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("IG-only Smart Upload — FB needs_review without publication", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "needs_review",
      igContentStatus: "published",
      igPub: "published",
      igOnly: true,
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("batch mismatch", async () => {
    const { igPub, igContent } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
      batchId: BATCH,
    });
    await store.updateContent(igContent.id, {
      metadata: { ...igContent.metadata, batchId: "other-batch" },
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("scheduled_for mismatch", async () => {
    const { igPub, fbPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    await store.updatePublication(fbPub!.id, { scheduledFor: "2026-10-11T16:00:00.000Z" });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("scheduled_for null on failed leg", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
      igPubPatch: { scheduledFor: null },
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("pending safe retry on failed leg", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
      igPubPatch: {
        attemptCount: 1,
        lastError: `meta_http_error: timeout ${PUBLICATION_CRON_SAFE_RETRY_PROOF}`,
      },
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("recovery-required failed leg", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
      igPubPatch: {
        providerCreationId: "18104922968283771",
        externalId: null,
        lastError: "meta_media_not_ready: wait",
      },
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("ambiguous failed leg", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
      igPubPatch: { ambiguityState: "ambiguous" },
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("credential failure class", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
      igPubPatch: { lastError: "meta_auth_expired: token" },
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("processing sibling blocks partial", async () => {
    const { igPub, fbPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "processing",
      igPub: "failed",
    });
    await store.updateContent(fbPub!.contentId, { status: "scheduled" });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("stale content schedule vs publication", async () => {
    const { igPub, igContent } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    await store.updateContent(igContent.id, {
      scheduledFor: "2026-10-11T16:00:00.000Z",
    });
    assert.equal(await observePartialPublicationFailure(store, igPub!.id, "test", { ...hookProspective(), repository: repo }), null);
  });

  it("recycle publication on failed leg is not canonical — skipped", async () => {
    const { igContent, fbPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const recyclePub = await store.createPublication({
      ...publicationRow(igContent, pubId("000000000099"), "failed"),
      idempotencyKey: `pub:${igContent.id}:instagram:recycle:${pubId("000000000099")}`,
    });
    await store.updatePublication(recyclePub.id, { updatedAt: PROSPECTIVE_NOW });
    assert.equal(
      await observePartialPublicationFailure(store, recyclePub.id, "test", {
        ...hookProspective(),
        repository: repo,
      }),
      null,
    );
    const canonical = await store.getPublicationByIdempotency(
      canonicalPublicationIdempotencyKey(igContent.id, "instagram"),
    );
    assert.ok(canonical);
    assert.ok(
      await observePartialPublicationFailure(store, canonical!.id, "test", {
        ...hookProspective(),
        repository: repo,
      }),
    );
  });

  it("occurrence-only publication_failed does not trigger partial hook", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!;
    await recordPublicationFailedIncidentResult(actionableIg, "first", repo);
    await observePublicationFailureOutcomes(actionableIg, {
      sourceOperation: "second",
      repository: repo,
      store,
      notifyFailed: async () => {},
    });
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "partial_publication_failure").length,
      0,
    );
  });

  it("historical failed row touch does not qualify without new transition", async () => {
    const { igPub, fbPub } = await seedPair(store, {
      fbContentStatus: "scheduled",
      igContentStatus: "failed",
      fbPub: "scheduled",
      igPub: "failed",
    });
    await recordPublicationFailedIncidentResult(
      (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!,
      "historical",
      repo,
    );
    setPartialPublicationFailureEnabledAtForTests("2099-01-01T00:00:00.000Z");
    await store.updatePublication(igPub!.id, { lastError: "meta_http_error: touched" });
    await store.updatePublication(fbPub!.id, {
      status: "published",
      externalId: "ext-fb",
      publishedAt: PROSPECTIVE_NOW,
    });
    await store.updateContent(fbPub!.contentId, { status: "published" });
    assert.equal(
      await observePartialPublicationFailureForPublishedCounterpart(
        store,
        (await store.getPublication(fbPub!.id))!,
        "sweep",
        repo,
      ),
      null,
    );
  });

  it("failure first then counterpart publishes — published-leg sweep", async () => {
    const { igPub, fbPub, fbContent, igContent } = await seedPair(store, {
      fbContentStatus: "scheduled",
      igContentStatus: "failed",
      fbPub: "processing",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!;
    await recordPublicationFailedIncidentResult(actionableIg, "ig_fail", repo);
    assert.equal(
      await observePartialPublicationFailure(store, igPub!.id, "hook", {
        ...hookProspective(),
        repository: repo,
      }),
      null,
    );
    const publishedFb = (await store.updatePublication(fbPub!.id, {
      status: "published",
      externalId: "ext-fb",
      publishedAt: PROSPECTIVE_NOW,
    }))!;
    await store.updateContent(fbContent.id, { status: "published" });
    await store.updateContent(igContent.id, { status: "failed" });
    const partial = await observePartialPublicationFailureForPublishedCounterpart(
      store,
      publishedFb,
      "sweep",
      repo,
    );
    assert.ok(partial);
  });

  it("counterpart publishes first then failure — hook transition", async () => {
    const { igPub, fbPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "scheduled",
      fbPub: "published",
      igPub: "scheduled",
    });
    const failedIg = (await store.updatePublication(igPub!.id, {
      status: "failed",
      attemptCount: 3,
      lastError: "meta_http_error: terminal failure",
    }))!;
    await store.updateContent(igPub!.contentId, { status: "failed" });
    await observePublicationFailureOutcomes(failedIg, {
      sourceOperation: "test",
      repository: repo,
      store,
      notifyFailed: async () => {},
    });
    assert.ok(
      repo.listIncidents().some((i) => i.incidentType === "partial_publication_failure"),
    );
    assert.ok((await store.getPublication(fbPub!.id))!.status === "published");
  });

  it("hook + sweep dedupe — single incident", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    await recordPublicationFailedIncidentResult(
      (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!,
      "pf",
      repo,
    );
    await observePartialPublicationFailure(store, igPub!.id, "hook", {
      ...hookProspective(),
      repository: repo,
    });
    await runPartialPublicationFailureBackupSweep(
      store,
      { failedInCycle: [igPub!], publishedInCycle: [] },
      repo,
    );
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "partial_publication_failure").length,
      1,
    );
  });

  it("reopen after resolve on re-observation", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const first = await observePartialPublicationFailure(store, igPub!.id, "test", {
      ...hookProspective(),
      repository: repo,
    });
    assert.ok(first);
    await resolveIncident(repo, first!.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "done",
    });
    const second = await observePartialPublicationFailure(store, igPub!.id, "test2", {
      ...hookProspective("reopened"),
      repository: repo,
    });
    assert.ok(second);
    assert.equal(second!.status, "open");
    assert.equal(second!.id, first!.id);
  });

  it("no partial push; publication_failed push still fires", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, {
      attemptCount: 3,
      lastError: "meta_http_error: terminal failure",
    }))!;
    await observePublicationFailureOutcomes(actionableIg, {
      sourceOperation: "test",
      repository: repo,
      store,
      notifyFailed: async (pub, incident, outcome) => {
        if (outcome === "created" || outcome === "reopened") {
          notifyCalls.push({
            type: "publication_failed",
            severity: "error",
            title: "fail",
            body: "body",
            destination: "/admin/marketing/week",
            relatedPublicationId: pub.id,
            relatedIncidentId: incident.id,
          });
        }
      },
    });
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "partial_publication_failure").length,
      1,
    );
    assert.equal(notifyCalls.filter((n) => n.type === "publication_failed").length, 1);
    assert.equal(notifyCalls.filter((n) => n.type === "partial_publication_failure").length, 0);
  });

  it("sweep only processes publish-cycle candidates", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    await store.updatePublication(igPub!.id, { attemptCount: 3 });
    await recordPublicationFailedIncidentResult(
      (await store.getPublication(igPub!.id))!,
      "sweep",
      repo,
    );
    const sweep = await runMarketingReliabilitySweep({
      detect: { overdue: [], stuck: [] },
      cleanupDedupes: async () => 0,
      reconcile: async () => ({
        examined: 0,
        autoResolved: 0,
        overdueAutoResolved: 0,
        stuckAutoResolved: 0,
        skippedUnsafe: 0,
        skippedMissingPublication: 0,
        skippedConflict: 0,
        skippedPolicy: 0,
        failed: 0,
      }),
      partialPublicationFailureBackup: {
        failedInCycle: [(await store.getPublication(igPub!.id))!],
        publishedInCycle: [],
      },
      store,
    });
    assert.equal(sweep.partialPublicationFailureObserved, 1);
    const emptySweep = await runMarketingReliabilitySweep({
      detect: { overdue: [], stuck: [] },
      cleanupDedupes: async () => 0,
      reconcile: async () => ({
        examined: 0,
        autoResolved: 0,
        overdueAutoResolved: 0,
        stuckAutoResolved: 0,
        skippedUnsafe: 0,
        skippedMissingPublication: 0,
        skippedConflict: 0,
        skippedPolicy: 0,
        failed: 0,
      }),
      partialPublicationFailureBackup: { failedInCycle: [], publishedInCycle: [] },
      store,
    });
    assert.equal(emptySweep.partialPublicationFailureObserved, 0);
  });

  it("hook partial write failure then sweep recovers via published counterpart", async () => {
    const { igPub, fbPub, fbContent } = await seedPair(store, {
      fbContentStatus: "scheduled",
      igContentStatus: "failed",
      fbPub: "scheduled",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!;
    await recordPublicationFailedIncidentResult(actionableIg, "pf", repo);
    const brokenRepo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(brokenRepo);
    brokenRepo.insertIncident = async () => {
      throw new Error("db down");
    };
    assert.equal(
      await observePartialPublicationFailure(store, igPub!.id, "hook", {
        ...hookProspective(),
        repository: brokenRepo,
      }),
      null,
    );
    setMarketingIncidentRepositoryForTests(repo);
    const publishedFb = (await store.updatePublication(fbPub!.id, {
      status: "published",
      externalId: "ext",
      publishedAt: PROSPECTIVE_NOW,
    }))!;
    await store.updateContent(fbContent.id, { status: "published" });
    const recorded = await runPartialPublicationFailureBackupSweep(
      store,
      { failedInCycle: [], publishedInCycle: [publishedFb] },
      repo,
    );
    assert.equal(recorded, 1);
  });

  it("incident record failure does not throw from observe", async () => {
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const brokenRepo = createMemoryIncidentRepository();
    const original = brokenRepo.insertIncident.bind(brokenRepo);
    brokenRepo.insertIncident = async () => {
      throw new Error("db down");
    };
    await assert.doesNotReject(async () => {
      assert.equal(
        await observePartialPublicationFailure(store, igPub!.id, "test", {
          ...hookProspective(),
          repository: brokenRepo,
        }),
        null,
      );
    });
    brokenRepo.insertIncident = original;
  });

  it("partial observation is off when MARKETING_PARTIAL_PUBLICATION_FAILURE_ENABLED_AT is unset", async () => {
    setPartialPublicationFailureEnabledAtForTests(null);
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!;
    await observePublicationFailureOutcomes(actionableIg, {
      sourceOperation: "test",
      repository: repo,
      store,
      notifyFailed: async () => {},
    });
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "partial_publication_failure").length,
      0,
    );
  });

  it("pre-activation publication_failed reopened after activation does not qualify for partial hook", async () => {
    const historicalFirstSeen = "2020-01-01T00:00:00.000Z";
    setPartialPublicationFailureEnabledAtForTests(PROSPECTIVE_NOW);
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!;
    await recordIncident(
      repo,
      {
        incidentType: "publication_failed",
        status: "action_required",
        severity: "error",
        sourceOperation: "historical",
        dedupeKey: publicationFailedIncidentDedupeKey(igPub!.id),
        errorClass: "meta_http_error",
        errorMessage: "historical",
        retrySafety: "safe_manual",
        permittedActions: ["investigate_read_only"],
        humanApprovalRequired: false,
        contentId: actionableIg.contentId,
        publicationId: actionableIg.id,
        platform: actionableIg.platform,
        provider: actionableIg.provider,
        detectedAt: historicalFirstSeen,
        evidence: {},
      },
      { reopenIfResolved: true },
    );
    await resolveIncident(repo, repo.listIncidents().find((i) => i.incidentType === "publication_failed")!.id, {
      resolutionType: "owner_resolved",
      resolutionSummary: "cleared",
    });
    await observePublicationFailureOutcomes(actionableIg, {
      sourceOperation: "after_activation",
      repository: repo,
      store,
      notifyFailed: async () => {},
    });
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "partial_publication_failure").length,
      0,
    );
  });

  it("hook and sweep share first_seen_at anchor on publication_failed", async () => {
    const anchor = "2026-10-05T12:00:00.000Z";
    setPartialPublicationFailureEnabledAtForTests("2026-10-05T00:00:00.000Z");
    const { igPub } = await seedPair(store, {
      fbContentStatus: "published",
      igContentStatus: "failed",
      fbPub: "published",
      igPub: "failed",
    });
    const actionableIg = (await store.updatePublication(igPub!.id, { attemptCount: 3 }))!;
    const pf = await recordIncident(
      repo,
      {
        incidentType: "publication_failed",
        status: "action_required",
        severity: "error",
        sourceOperation: "anchor",
        dedupeKey: publicationFailedIncidentDedupeKey(igPub!.id),
        errorClass: "meta_http_error",
        errorMessage: "err",
        retrySafety: "safe_manual",
        permittedActions: ["investigate_read_only"],
        humanApprovalRequired: false,
        contentId: actionableIg.contentId,
        publicationId: actionableIg.id,
        platform: actionableIg.platform,
        provider: actionableIg.provider,
        detectedAt: anchor,
        evidence: {},
      },
      { reopenIfResolved: true },
    );
    assert.equal(pf.incident.firstSeenAt, anchor);
    const hook = await observePartialPublicationFailure(store, igPub!.id, "hook", {
      prospective: {
        kind: "hook_actionable_failure_transition",
        publicationFailedOutcome: "created",
        publicationFailedFirstSeenAt: pf.incident.firstSeenAt,
      },
      repository: repo,
    });
    assert.ok(hook);
    await runPartialPublicationFailureBackupSweep(
      store,
      { failedInCycle: [actionableIg], publishedInCycle: [] },
      repo,
    );
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "partial_publication_failure").length,
      1,
    );
  });

  it("B1 publication_failed never persisted — published-leg sweep cannot create partial", async () => {
    const { igPub, fbPub, fbContent } = await seedPair(store, {
      fbContentStatus: "scheduled",
      igContentStatus: "failed",
      fbPub: "scheduled",
      igPub: "failed",
    });
    await store.updatePublication(igPub!.id, { attemptCount: 3 });
    const publishedFb = (await store.updatePublication(fbPub!.id, {
      status: "published",
      externalId: "ext",
      publishedAt: PROSPECTIVE_NOW,
    }))!;
    await store.updateContent(fbContent.id, { status: "published" });
    const recorded = await runPartialPublicationFailureBackupSweep(
      store,
      { failedInCycle: [], publishedInCycle: [publishedFb] },
      repo,
    );
    assert.equal(recorded, 0);
  });

  it("validatePartialPublicationFailureEnabledAt rejects missing and invalid values", () => {
    assert.equal(validatePartialPublicationFailureEnabledAt(undefined).ok, false);
    assert.equal(validatePartialPublicationFailureEnabledAt("not-a-date").ok, false);
    assert.equal(validatePartialPublicationFailureEnabledAt("2026-10-08").ok, false);
    const ok = validatePartialPublicationFailureEnabledAt("2026-10-08T12:00:00.000Z");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.iso, "2026-10-08T12:00:00.000Z");
    }
  });
});
