import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import sharp from "sharp";
import type { AIProvider } from "../ai";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { resolveIncident } from "../incidents/record";
import { setMarketingIncidentRepositoryForTests } from "../incidents/runtime-repository";
import {
  setSendMarketingAdminBroadcastForTests,
  type SendMarketingAdminBroadcastInput,
  type SendMarketingAdminBroadcastResult,
} from "../notifications/broadcast";
import type {
  MarketingAdminNotificationRecord,
  MarketingNotificationPayload,
} from "../notifications/types";
import { MemoryMarketingStore } from "../memory-store";
import { classifyMetaHttpError } from "../meta";
import {
  isPublicationBlockedForAutomaticMetaRetry,
  publicationRetryBlockedReason,
} from "../publication-ambiguity/guards";
import {
  applyAmbiguousPublicationOutcome,
  applyConfirmedPublicationFailure,
} from "../publication-ambiguity/apply-outcome";
import { PUBLICATION_CRON_SAFE_RETRY_PROOF } from "../publication-cron-retry";
import { generateSmartUploadCaptions } from "../smart-upload-caption";
import {
  SmartUploadCaptionGroundingError,
  SmartUploadCaptionProviderError,
} from "../smart-upload-caption-errors";
import { setSmartUploadCaptionBufferReaderForTests } from "../smart-upload-caption-image";
import { issueSmartUploadIntent } from "../smart-upload-intent";
import { finalizeSmartUploadFromBuffer } from "../smart-upload";
import type { MarketingPublication } from "../types";
import { parsePublicationErrorClass } from "./evidence";
import { notifyPublicationFailedWithDeps } from "./failed-notify";
import { recordPublicationFailedIncidentResult } from "./failed";
import { observePublicationFailureOutcomes } from "./observe-failure-outcomes";
import {
  evaluatePublicationFailedCapture,
  isCredentialClassPublicationError,
  isPublicationEligibleForAutomaticCronRetry,
} from "./publication-failed-eligibility";

const B1_CONTENT_ID = "11111111-1111-4111-8111-111111110001";
const CAPTION_PATH = `marketing/public/${"c".repeat(32)}.png`;
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function b1PubId(slot: number): string {
  const tail = slot.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${tail}`;
}

const CRON_SAFE = `meta_http_error: timeout ${PUBLICATION_CRON_SAFE_RETRY_PROOF}`;

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

function publicationSafetySnapshot(
  publication: MarketingPublication,
): Record<string, unknown> {
  return {
    status: publication.status,
    scheduledFor: publication.scheduledFor,
    attemptCount: publication.attemptCount,
    lastError: publication.lastError,
    ambiguityState: publication.ambiguityState,
    claimToken: publication.claimToken,
    processingStartedAt: publication.processingStartedAt,
    providerCreationId: publication.providerCreationId,
    externalId: publication.externalId,
    updatedAt: publication.updatedAt,
  };
}

function wouldPublishDueRetryFailedPublication(publication: MarketingPublication): boolean {
  if (publication.status !== "failed") return false;
  return isPublicationEligibleForAutomaticCronRetry(publication);
}

class FinalizePersistenceFailureStore extends MemoryMarketingStore {
  async createContent(
    input: Parameters<MemoryMarketingStore["createContent"]>[0],
  ): ReturnType<MemoryMarketingStore["createContent"]> {
    throw new Error("database unavailable");
  }
}

async function pngBuffer(width = 1080, height = 1080): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 110, b: 130 },
    },
  })
    .png()
    .toBuffer();
}

function memoryPublicationFailedNotifyDeps(tracker?: {
  payloads: MarketingNotificationPayload[];
  notifyCalls: number;
}) {
  return {
    claimDedupe: async () => true,
    notify: async (payload: MarketingNotificationPayload) => {
      tracker?.notifyCalls && (tracker.notifyCalls += 1);
      tracker?.payloads.push(payload);
      return { notificationId: crypto.randomUUID() };
    },
    attachDedupe: async () => {},
    releaseDedupe: async () => {},
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

function failingProvider(): AIProvider {
  return {
    id: "test-fail",
    async generateText() {
      return "";
    },
    async generateStructuredOutput({ fallback }) {
      return fallback;
    },
    async generateMultimodalStructuredOutput() {
      throw new SmartUploadCaptionProviderError("Caption model response bad");
    },
    async classify() {
      return "";
    },
    async analyze() {
      return "";
    },
  };
}

const originalAdminSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "phase3b1-hardening-secret";
  setSmartUploadCaptionBufferReaderForTests(async () => TINY_PNG);
});

afterEach(() => {
  setSmartUploadCaptionBufferReaderForTests(null);
  setSendMarketingAdminBroadcastForTests(null);
  setMarketingIncidentRepositoryForTests(null);
  if (originalAdminSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalAdminSecret;
});

describe("Phase III-B1 hardening — publication_failed notification success", () => {
  it("end-to-end: actionable failure → incident → broadcast once with related_incident_id", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const pubId = b1PubId(0x101);
    const pub = await store.createPublication(
      basePublication({
        id: pubId,
        status: "scheduled",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    assert.ok(claimed?.claimToken);

    const payloads: MarketingNotificationPayload[] = [];
    let notifyCalls = 0;

    await applyConfirmedPublicationFailure(
      store,
      {
        publication: claimed!,
        claimToken: claimed!.claimToken!,
        attemptCount: 3,
        lastError: "meta_http_error: terminal",
        cronAutoRetry: false,
        platform: "instagram",
        providerRetryable: false,
      },
      {
        observeFailureOutcomes: {
          repository: repo,
          notifyFailed: async (publication, incident, outcome) => {
            await notifyPublicationFailedWithDeps(publication, incident, outcome, {
              ...memoryPublicationFailedNotifyDeps({ payloads, notifyCalls: 0 }),
              notify: async (payload) => {
                notifyCalls += 1;
                payloads.push(payload);
                return { notificationId: crypto.randomUUID() };
              },
            });
          },
        },
      },
    );

    assert.equal(repo.listIncidents().length, 1);
    const incident = repo.listIncidents()[0]!;
    assert.equal(incident.incidentType, "publication_failed");
    assert.equal(notifyCalls, 1);
    assert.equal(payloads[0]!.relatedIncidentId, incident.id);
    assert.equal(payloads[0]!.relatedPublicationId, pubId);
    assert.equal(payloads[0]!.destination, "/admin/marketing/week");
  });

  it("repeat observation does not broadcast again; reopened after resolve may notify", async () => {
    const repo = createMemoryIncidentRepository();
    const pub = basePublication({ id: b1PubId(0x102), attemptCount: 3 });
    const first = await recordPublicationFailedIncidentResult(pub, "t1", repo);
    assert.ok(first);

    let notifyCount = 0;
    const deps = {
      claimDedupe: async () => true,
      notify: async () => {
        notifyCount += 1;
        return { notificationId: crypto.randomUUID() };
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    };

    await notifyPublicationFailedWithDeps(pub, first!.incident, first!.outcome, deps);
    assert.equal(notifyCount, 1);

    const second = await recordPublicationFailedIncidentResult(pub, "t2", repo);
    await notifyPublicationFailedWithDeps(pub, second!.incident, second!.outcome, deps);
    assert.equal(notifyCount, 1);

    await resolveIncident(repo, first!.incident.id, {
      resolutionType: "owner_resolved",
      actor: "owner",
      resolutionSummary: "done",
    });
    const third = await recordPublicationFailedIncidentResult(pub, "t3", repo);
    assert.equal(third!.outcome, "reopened");
    await notifyPublicationFailedWithDeps(pub, third!.incident, third!.outcome, deps);
    assert.equal(notifyCount, 2);
  });

  it("safe cron-retryable failure creates neither incident nor broadcast", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const pub = await store.createPublication(
      basePublication({
        id: b1PubId(0x103),
        status: "scheduled",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    let notifyCalls = 0;
    await applyConfirmedPublicationFailure(
      store,
      {
        publication: claimed!,
        claimToken: claimed!.claimToken!,
        attemptCount: 1,
        lastError: "meta_http_error: timeout",
        cronAutoRetry: true,
        platform: "instagram",
        providerRetryable: true,
      },
      {
        observeFailureOutcomes: {
          repository: repo,
          notifyFailed: async (publication, incident, outcome) => {
            notifyCalls += 1;
            await notifyPublicationFailedWithDeps(
              publication,
              incident,
              outcome,
              memoryPublicationFailedNotifyDeps(),
            );
          },
        },
      },
    );

    assert.equal(repo.listIncidents().length, 0);
    assert.equal(notifyCalls, 0);
  });
});

describe("Phase III-B1 hardening — notification failure path", () => {
  it("incident recorded; notify throws; publication unchanged; dedupe released", async () => {
    const repo = createMemoryIncidentRepository();
    const store = new MemoryMarketingStore();
    const pubId = b1PubId(0x201);
    await store.createPublication(
      basePublication({
        id: pubId,
        status: "scheduled",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pubId);
    assert.ok(claimed?.claimToken);
    const failedRow = await store.finalizePublicationClaim({
      id: pubId,
      claimToken: claimed!.claimToken!,
      patch: {
        status: "failed",
        attemptCount: 3,
        lastError: "meta_http_error: terminal",
        ambiguityState: "none",
        claimToken: null,
        processingStartedAt: null,
        providerCreationId: null,
      },
    });
    assert.ok(failedRow);
    const snap = publicationSafetySnapshot(failedRow);

    let released = false;
    await observePublicationFailureOutcomes(failedRow, {
      sourceOperation: "test_notify_fail",
      repository: repo,
      notifyFailed: async (publication, incident, outcome) => {
        await notifyPublicationFailedWithDeps(publication, incident, outcome, {
          claimDedupe: async () => true,
          notify: async () => {
            throw new Error("simulated notify failure");
          },
          attachDedupe: async () => {},
          releaseDedupe: async () => {
            released = true;
          },
        });
      },
    });

    const afterObserve = await store.getPublication(pubId);
    assert.deepEqual(publicationSafetySnapshot(afterObserve!), snap);
    assert.equal(repo.listIncidents().length, 1);
    assert.equal(released, true);
  });
});

describe("Phase III-B1 hardening — recovery notification success", () => {
  it("prospective recovery failure → recovery incident → notify with related_incident_id", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const pubId = b1PubId(0x301);
    let recoveryNotifyCalls = 0;
    let applyRelatedIncidentId: string | null = null;
    const pub = await store.createPublication(
      basePublication({
        id: pubId,
        status: "scheduled",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pub.id);
    const updated = await applyConfirmedPublicationFailure(
      store,
      {
        publication: { ...claimed!, providerCreationId: "18104922968283771" },
        claimToken: claimed!.claimToken!,
        attemptCount: 1,
        lastError: "meta_publish_failed: incomplete",
        cronAutoRetry: false,
        platform: "instagram",
        providerRetryable: false,
      },
      {
        observeFailureOutcomes: {
          repository: repo,
          notifyRecoveryDeps: {
            sendBroadcast: async (payload) => {
              recoveryNotifyCalls += 1;
              applyRelatedIncidentId = payload.relatedIncidentId ?? null;
              return { notification: { id: crypto.randomUUID() } };
            },
          },
        },
      },
    );
    assert.ok(updated);

    const incidents = repo.listIncidents();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]!.incidentType, "publication_recovery_required");
    assert.equal(
      repo.listIncidents().some((i) => i.incidentType === "publication_failed"),
      false,
    );
    assert.equal(recoveryNotifyCalls, 1);
    assert.equal(applyRelatedIncidentId, incidents[0]!.id);

    let repeatCalls = 0;
    await observePublicationFailureOutcomes(updated, {
      sourceOperation: "test_recovery_repeat",
      repository: repo,
      notifyRecoveryDeps: {
        sendBroadcast: async () => {
          repeatCalls += 1;
          return { notification: { id: crypto.randomUUID() } };
        },
      },
    });
    assert.equal(repeatCalls, 0);
  });
});

describe("Phase III-B1 hardening — publication immutability", () => {
  it("observation and notification do not mutate publication safety fields", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const pubId = b1PubId(0x401);
    await store.createPublication(
      basePublication({
        id: pubId,
        status: "scheduled",
        scheduledFor: new Date().toISOString(),
      }),
    );
    const claimed = await store.claimPublication(pubId);
    await applyConfirmedPublicationFailure(
      store,
      {
        publication: claimed!,
        claimToken: claimed!.claimToken!,
        attemptCount: 3,
        lastError: "meta_http_error: x",
        cronAutoRetry: false,
        platform: "instagram",
        providerRetryable: false,
      },
      {
        observeFailureOutcomes: {
          repository: repo,
          notifyFailed: async (publication, incident, outcome) => {
            await notifyPublicationFailedWithDeps(
              publication,
              incident,
              outcome,
              memoryPublicationFailedNotifyDeps(),
            );
          },
        },
      },
    );
    const afterFailure = await store.getPublication(pubId);
    const snap = publicationSafetySnapshot(afterFailure!);

    await observePublicationFailureOutcomes(afterFailure!, {
      sourceOperation: "repeat_observe",
      repository: repo,
      notifyFailed: async (publication, incident, outcome) => {
        await notifyPublicationFailedWithDeps(
          publication,
          incident,
          outcome,
          memoryPublicationFailedNotifyDeps(),
        );
      },
    });

    const afterObserve = await store.getPublication(pubId);
    assert.deepEqual(publicationSafetySnapshot(afterObserve!), snap);
  });
});

describe("Phase III-B1 hardening — Admin Retry permission envelope", () => {
  async function permitted(pub: MarketingPublication): Promise<string[]> {
    const repo = createMemoryIncidentRepository();
    const result = await recordPublicationFailedIncidentResult(pub, "admin_env", repo);
    return result?.incident.permittedActions ?? [];
  }

  it("clean actionable failure may include admin_retry_publication", async () => {
    const actions = await permitted(
      basePublication({ id: b1PubId(0x501), attemptCount: 3, ambiguityState: "none" }),
    );
    assert.ok(actions.includes("admin_retry_publication"));
    assert.equal(publicationRetryBlockedReason(basePublication({ id: b1PubId(0x501) })), null);
  });

  it("ambiguous / owner_required / recovery / credential do not get publication_failed", async () => {
    const repo = createMemoryIncidentRepository();
    for (const pub of [
      basePublication({ id: b1PubId(0x502), ambiguityState: "ambiguous", attemptCount: 3 }),
      basePublication({ id: b1PubId(0x503), ambiguityState: "owner_required", attemptCount: 3 }),
      basePublication({
        id: b1PubId(0x504),
        attemptCount: 3,
        providerCreationId: "18104922968283771",
        externalId: null,
      }),
      basePublication({
        id: b1PubId(0x505),
        attemptCount: 3,
        lastError: "meta_permissions: missing scope",
      }),
    ]) {
      assert.equal(await recordPublicationFailedIncidentResult(pub, "x", repo), null);
    }
  });
});

describe("Phase III-B1 hardening — credential exclusion matrix", () => {
  const classes = ["meta_credentials_missing", "meta_auth_expired", "meta_permissions"] as const;

  for (const code of classes) {
    it(`${code} excluded with suffix and parseable prefix`, () => {
      const lastError = `${code}: details here ${PUBLICATION_CRON_SAFE_RETRY_PROOF}`;
      assert.equal(parsePublicationErrorClass(lastError), code);
      assert.equal(isCredentialClassPublicationError(code), true);
      const pub = basePublication({ id: b1PubId(0x600 + classes.indexOf(code)), attemptCount: 3, lastError });
      assert.equal(evaluatePublicationFailedCapture(pub).capture, false);
    });
  }

  it("meta production error strings remain parseable", () => {
    const samples = [
      classifyMetaHttpError(400, { error: { code: 190, message: "token" } }, []),
      classifyMetaHttpError(400, { error: { code: 10, message: "perm" } }, []),
      classifyMetaHttpError(400, { error: { message: "missing creds" } }, []),
    ];
    assert.equal(parsePublicationErrorClass(samples[0].error), "meta_auth_expired");
    assert.equal(parsePublicationErrorClass(samples[1].error), "meta_permissions");
    assert.equal(
      parsePublicationErrorClass(
        "meta_credentials_missing: Set META_INSTAGRAM_USER_ID and META_INSTAGRAM_ACCESS_TOKEN.",
      ),
      "meta_credentials_missing",
    );
  });

  it("unrelated meta error is not credential-class", () => {
    const pub = basePublication({
      id: b1PubId(0x610),
      attemptCount: 3,
      lastError: "meta_http_error: timeout",
    });
    assert.equal(evaluatePublicationFailedCapture(pub).capture, true);
  });
});

describe("Phase III-B1 hardening — cron retry eligibility consistency", () => {
  const cases: Array<{
    label: string;
    patch: Partial<MarketingPublication>;
    lastError?: string;
  }> = [
    { label: "attempt1+cron", patch: { attemptCount: 1 }, lastError: CRON_SAFE },
    { label: "attempt2+cron", patch: { attemptCount: 2 }, lastError: CRON_SAFE },
    { label: "attempt3+cron", patch: { attemptCount: 3 }, lastError: CRON_SAFE },
    { label: "attempt1+no marker", patch: { attemptCount: 1 }, lastError: "meta_policy: x" },
    { label: "ambiguous", patch: { attemptCount: 1, ambiguityState: "ambiguous" }, lastError: CRON_SAFE },
    {
      label: "recovery",
      patch: {
        attemptCount: 1,
        providerCreationId: "18104922968283771",
        externalId: null,
      },
      lastError: CRON_SAFE,
    },
    { label: "credential", patch: { attemptCount: 3 }, lastError: "meta_auth_expired: x" },
    { label: "terminal", patch: { attemptCount: 1 }, lastError: "meta_policy_violation: x" },
  ];

  for (const row of cases) {
    it(`capture aligns with publishDue for ${row.label}`, () => {
      const pub = basePublication({
        id: b1PubId(0x700 + cases.indexOf(row)),
        lastError: row.lastError ?? "meta_http_error: x",
        ...row.patch,
      });
      const wouldRetry = wouldPublishDueRetryFailedPublication(pub);
      const decision = evaluatePublicationFailedCapture(pub);
      if (wouldRetry) {
        assert.equal(decision.capture, false);
      }
      if (decision.capture) {
        assert.equal(wouldRetry, false);
      }
      assert.equal(
        isPublicationEligibleForAutomaticCronRetry(pub),
        wouldRetry,
      );
      if (row.patch.ambiguityState === "ambiguous") {
        assert.equal(isPublicationBlockedForAutomaticMetaRetry(pub), true);
      }
    });
  }
});

describe("Phase III-B1 hardening — Smart Upload production boundaries", () => {
  it("caption provider failure records incident; grounding does not", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const store = new MemoryMarketingStore();
    const finalizeKey = "fk-caption-boundary-1";
    const uploadIntent = issueSmartUploadIntent({
      username: "owner",
      pathname: CAPTION_PATH,
    }).uploadIntent;

    let broadcasts = 0;
    setSendMarketingAdminBroadcastForTests(async () => {
      broadcasts += 1;
      throw new Error("should not broadcast");
    });

    await assert.rejects(
      () =>
        generateSmartUploadCaptions(store, {
          actorUsername: "owner",
          mode: "shared",
          instructions: null,
          explicitCta: null,
          bookId: "book-one",
          campaignId: null,
          original: { uploadIntent, pathname: CAPTION_PATH },
          acceptedDerivative: null,
          finalizeKey,
          provider: failingProvider(),
        }),
      SmartUploadCaptionProviderError,
    );

    assert.equal(repo.listIncidents().length, 1);
    assert.equal(repo.listIncidents()[0]!.incidentType, "smart_upload_caption_failed");
    assert.equal(repo.listIncidents()[0]!.finalizeKey, finalizeKey);
    assert.equal(broadcasts, 0);

    await assert.rejects(
      () =>
        generateSmartUploadCaptions(store, {
          actorUsername: "owner",
          mode: "shared",
          instructions: null,
          explicitCta: null,
          bookId: "book-unknown",
          campaignId: null,
          original: { uploadIntent, pathname: CAPTION_PATH },
          acceptedDerivative: null,
          finalizeKey: "fk-other",
          provider: failingProvider(),
        }),
      /Unknown book/,
    );
    assert.equal(
      repo.listIncidents().filter((i) => i.incidentType === "smart_upload_caption_failed").length,
      1,
    );
  });

  it("finalize persistence failure records incident; validation and success do not", async () => {
    const repo = createMemoryIncidentRepository();
    setMarketingIncidentRepositoryForTests(repo);
    const finalizeKey = "fk-finalize-boundary-1";
    const buffer = await pngBuffer();
    let broadcasts = 0;
    setSendMarketingAdminBroadcastForTests(async () => {
      broadcasts += 1;
      throw new Error("should not broadcast");
    });

    const failingStore = new FinalizePersistenceFailureStore();
    await assert.rejects(
      () =>
        finalizeSmartUploadFromBuffer(failingStore, {
          caption: "Caption",
          batchId: "batch-b1",
          finalizeKey,
          weeklyPlanId: null,
          campaignId: null,
          actor: "owner",
          imageBuffer: buffer,
          imageFilename: "x.png",
        }),
      /database unavailable/,
    );
    assert.equal(repo.listIncidents()[0]!.incidentType, "smart_upload_finalize_failed");

    await assert.rejects(
      () =>
        finalizeSmartUploadFromBuffer(failingStore, {
          caption: "Caption",
          batchId: "batch-b1",
          finalizeKey: "fk-validation",
          weeklyPlanId: null,
          campaignId: null,
          actor: "owner",
          imageBuffer: buffer,
          imageFilename: "x.png",
          bookId: "not-a-real-book",
        }),
      /Unknown book/,
    );

    const okStore = new MemoryMarketingStore();
    const ok = await finalizeSmartUploadFromBuffer(okStore, {
      caption: "Caption ok",
      batchId: "batch-ok",
      finalizeKey: "fk-success",
      weeklyPlanId: null,
      campaignId: null,
      actor: "owner",
      imageBuffer: buffer,
      imageFilename: "ok.png",
    });
    assert.ok(ok.assetId);
    const replay = await finalizeSmartUploadFromBuffer(okStore, {
      caption: "Caption ok",
      batchId: "batch-ok",
      finalizeKey: "fk-success",
      weeklyPlanId: null,
      campaignId: null,
      actor: "owner",
      imageBuffer: buffer,
      imageFilename: "ok.png",
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(broadcasts, 0);
  });
});

test("Phase III-B1 hardening — Smart Upload modules have no notification imports (static)", () => {
  for (const rel of [
    "../smart-upload-incidents/observe.ts",
    "../smart-upload-incidents/record.ts",
    "../smart-upload-incidents/operational-errors.ts",
  ]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /notify|broadcast|sendMarketingAdminBroadcast/);
  }
});

test("Phase III-B1 hardening — prospective-only wiring (static)", () => {
  const files = [
    "./observe-failure-outcomes.ts",
    "./failed.ts",
    "./recovery-required.ts",
    "../publication-ambiguity/apply-outcome.ts",
    "../smart-upload-incidents/observe.ts",
  ];
  for (const rel of files) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /listPublications\s*\(\s*["']failed["']\s*\)/);
    assert.doesNotMatch(src, /4d5d10f1-f3a7-4d40-8855-7390db9187c8/);
  }
});
