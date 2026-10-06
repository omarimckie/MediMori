import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { publishDue, publishPublication, scheduleApproved } from "../approval";
import { ensureCatalogAssets } from "../assets";
import { MemoryMarketingStore } from "../memory-store";
import { InstagramPublisher } from "../publishers";
import {
  isPublicationEligibleForCronAutoRetry,
  PUBLICATION_CRON_SAFE_RETRY_PROOF,
} from "../publication-cron-retry";
import { notifyReliabilityPayload } from "../reliability/notify";
import { publicationAmbiguousOutcomeDedupeKey } from "../reliability/dedupe-keys";
import { retryAdminPublication } from "../publication-retry";
import { classifyProviderPublishResult } from "./classify";
import {
  buildAmbiguousOutcomeNotificationPayload,
  getAmbiguousOutcomeNotifyInvocationCountForTests,
  notifyPublicationAmbiguousOutcomeWithDeps,
  resetAmbiguousOutcomeNotifyInvocationCountForTests,
} from "./notify";
import { PublicationScheduleBlockedError } from "./schedule-error";
import { PUBLICATION_PROVIDER_INFLIGHT_MARKER } from "./provider-inflight";
import type { MarketingContent, MarketingPublication } from "../types";

const originalMock = process.env.MARKETING_MOCK_MODE;

afterEach(() => {
  if (originalMock !== undefined) {
    process.env.MARKETING_MOCK_MODE = originalMock;
  }
  resetAmbiguousOutcomeNotifyInvocationCountForTests();
});

function basePublication(overrides: Partial<MarketingPublication> = {}): MarketingPublication {
  return {
    id: "pub-1",
    contentId: "content-1",
    campaignId: "camp",
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: "pub:content-1:instagram",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function seedInstagramPublishable(store: MemoryMarketingStore, contentStatus: MarketingContent["status"] = "approved") {
  const assets = await ensureCatalogAssets(store);
  const cover = assets.find((a) => a.url === "/covers/sickle-cell.png");
  assert.ok(cover);
  await store.updateAsset(cover.id, {
    url: "https://twilight-feather.vercel.app/instagram-api-test.png",
  });
  await store.createCampaign({
    id: "camp",
    name: "C",
    objective: "o",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "m",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta: null,
    requiredAssets: [],
    measurementGoals: [],
    bookIds: ["book-one"],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: true,
  });
  const content: MarketingContent = {
    id: "content-1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: contentStatus,
    title: "T",
    body: "Body",
    cta: "CTA",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [cover.id],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createContent(content);
  return content;
}

test("classify: publication_creation_id_persist_failed is ambiguous after provider interaction", () => {
  assert.equal(
    classifyProviderPublishResult(
      {
        ok: false,
        provider: "instagram",
        errorCode: "publication_creation_id_persist_failed",
        retryable: false,
        providerInteractionStarted: true,
      },
      { providerInteractionStarted: true },
    ),
    "ambiguous",
  );
});

test("notification payload distinguishes inflight sentinel from real container id", () => {
  const real = buildAmbiguousOutcomeNotificationPayload(
    basePublication({ providerCreationId: "17841400000000001" }),
  );
  assert.match(real.body, /preserved for later reconciliation/);
  assert.doesNotMatch(real.body, /__publish_inflight__/);

  const inflight = buildAmbiguousOutcomeNotificationPayload(
    basePublication({ providerCreationId: PUBLICATION_PROVIDER_INFLIGHT_MARKER }),
  );
  assert.match(inflight.body, /in-flight/);
  assert.doesNotMatch(inflight.body, /__publish_inflight__/);
});

test("A1: successful publication triggers zero ambiguity notification invocations", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  resetAmbiguousOutcomeNotifyInvocationCountForTests();
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  const pub = await store.createPublication(basePublication());
  await publishPublication(store, pub);
  assert.equal(getAmbiguousOutcomeNotifyInvocationCountForTests(), 0);
});

test("B2–B4: outcome notification path with dedupe and notifyReliabilityPayload seam", async () => {
  const pub = basePublication({ status: "failed", ambiguityState: "ambiguous" });
  const claimed = new Set<string>();
  let notifyCalls = 0;
  let lastPayload: { type: string } | null = null;
  await notifyPublicationAmbiguousOutcomeWithDeps(pub, "detail", {
    claimDedupe: async ({ dedupeKey }) => {
      if (claimed.has(dedupeKey)) return false;
      claimed.add(dedupeKey);
      return true;
    },
    notify: async (payload) => {
      notifyCalls += 1;
      lastPayload = payload;
      return { notificationId: "nid-1", pushDelivered: 0 };
    },
    attachDedupe: async () => {},
    releaseDedupe: async () => {},
  });
  assert.equal(notifyCalls, 1);
  assert.equal(lastPayload?.type, "publication_ambiguous");

  await notifyPublicationAmbiguousOutcomeWithDeps(pub, "detail", {
    claimDedupe: async ({ dedupeKey }) => {
      if (claimed.has(dedupeKey)) return false;
      claimed.add(dedupeKey);
      return true;
    },
    notify: async () => ({ notificationId: "nid-2", pushDelivered: 0 }),
    attachDedupe: async () => {},
    releaseDedupe: async () => {},
  });
  assert.equal(notifyCalls, 1);
  assert.equal(
    publicationAmbiguousOutcomeDedupeKey(pub.id),
    `publication_ambiguous:outcome:v1:${pub.id}`,
  );
});

test("B4: notifyReliabilityPayload enables Web Push on broadcast", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../reliability/notify.ts", import.meta.url)),
    "utf8",
  );
  assert.match(src, /deliverPush:\s*true/);
});

test("B5: notify failure does not mutate publication or re-enter Meta", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = "ig-token";
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  const publicationId = "pub-notify-fail";
  await store.createPublication(
    basePublication({ id: publicationId, idempotencyKey: "k-notify-fail", attemptCount: 0 }),
  );
  let metaCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    metaCalls += 1;
    if (method === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
    }
    if (method === "GET" && url.includes("c1")) {
      return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  const { applyAmbiguousPublicationOutcome } = await import("./apply-outcome");
  const { notifyPublicationAmbiguousOutcomeWithDeps: notifyWithDeps } = await import("./notify");

  try {
    const claimed = await store.claimPublication(publicationId);
    assert.ok(claimed?.claimToken);
    await store.tryBeginProviderPublish({ id: publicationId, claimToken: claimed!.claimToken! });
    const ambiguous = await applyAmbiguousPublicationOutcome(store, {
      publication: claimed!,
      claimToken: claimed!.claimToken!,
      attemptCount: 1,
      lastError: "meta_container_status_timeout: stuck",
    });
    assert.ok(ambiguous);
    await notifyWithDeps(ambiguous!, undefined, {
      claimDedupe: async () => true,
      notify: async () => {
        throw new Error("push failed");
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    });
    const after = await store.getPublication(publicationId);
    assert.equal(after?.ambiguityState, "ambiguous");
    assert.equal(isPublicationEligibleForCronAutoRetry(after?.lastError, after), false);
    metaCalls = 0;
    await publishDue(store);
    assert.equal(metaCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("C6: processing + inflight is skipped by publishDue", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  await store.createPublication(
    basePublication({
      status: "processing",
      claimToken: "active-claim",
      providerCreationId: PUBLICATION_PROVIDER_INFLIGHT_MARKER,
    }),
  );
  let calls = 0;
  const original = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async () => {
    calls += 1;
    return { ok: true, provider: "instagram", externalId: "x" };
  };
  try {
    await publishDue(store);
    assert.equal(calls, 0);
  } finally {
    InstagramPublisher.prototype.publish = original;
  }
});

test("D7: confirmed retryable failure clears inflight and allows new claim + provider entry", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  const pub = await store.createPublication(basePublication({ attemptCount: 0 }));
  const failed = await publishPublication(store, pub, { simulateFailure: true });
  assert.equal(failed.status, "failed");
  assert.equal(failed.providerCreationId, null);
  assert.ok(failed.lastError?.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF));
  const reclaimed = await store.claimPublication(pub.id);
  assert.ok(reclaimed?.claimToken);
  const entered = await store.tryBeginProviderPublish({
    id: pub.id,
    claimToken: reclaimed!.claimToken!,
  });
  assert.equal(entered, true);
});

test("E8: ambiguous failure retains real provider_creation_id and blocks cron", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = "ig-token";
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  const publicationId = "pub-ig-timeout";
  await store.createPublication(
    basePublication({ id: publicationId, idempotencyKey: "k-timeout", attemptCount: 0 }),
  );
  const publication = await store.getPublication(publicationId);
  assert.ok(publication);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "c-real" }), { status: 200 });
    }
    if (method === "GET" && url.includes("c-real")) {
      return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 });
    }
    if (url.endsWith("/media_publish")) {
      throw new Error("should not publish");
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const originalPublish = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async function (request) {
    const publisher = new InstagramPublisher({
      credentials: { userId: "ig-user", accessToken: "ig-token", graphVersion: "v22.0" },
      fetch: globalThis.fetch,
      sleep: async () => {},
    });
    return originalPublish.call(publisher, request);
  };
  try {
    const failed = await publishPublication(store, publication!);
    assert.equal(failed.ambiguityState, "ambiguous");
    assert.equal(failed.providerCreationId, "c-real");
    assert.equal(isPublicationEligibleForCronAutoRetry(failed.lastError, failed), false);
  } finally {
    globalThis.fetch = originalFetch;
    InstagramPublisher.prototype.publish = originalPublish;
  }
});

test("E9: persist failure is ambiguous, no media_publish, no v1 proof, admin blocked", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = "ig-token";
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  const publicationId = "pub-persist-fail";
  await store.createPublication(
    basePublication({ id: publicationId, idempotencyKey: "k-persist-fail", attemptCount: 0 }),
  );
  const publication = await store.getPublication(publicationId);
  assert.ok(publication);
  let mediaPublishCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "c-orphan" }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/media_publish")) {
      mediaPublishCalls += 1;
      return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const originalPersist = store.persistProviderCreationId.bind(store);
  store.persistProviderCreationId = async () => false;
  try {
    const failed = await publishPublication(store, publication!);
    assert.equal(failed.ambiguityState, "ambiguous");
    assert.equal(mediaPublishCalls, 0);
    assert.equal(failed.lastError?.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF), false);
    assert.equal(isPublicationEligibleForCronAutoRetry(failed.lastError, failed), false);
    let dueCalls = 0;
    InstagramPublisher.prototype.publish = async () => {
      dueCalls += 1;
      return { ok: true, provider: "instagram", externalId: "x" };
    };
    await publishDue(store);
    assert.equal(dueCalls, 0);
    assert.equal((await retryAdminPublication(store, publicationId)).status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    store.persistProviderCreationId = originalPersist;
  }
});

test("F10: ambiguous retry replaces v1 proof and blocks cron", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = "ig-token";
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  const publicationId = "pub-v1-then-ambiguous";
  await store.createPublication(
    basePublication({
      id: publicationId,
      idempotencyKey: "k-v1-ambig",
      status: "failed",
      attemptCount: 1,
      lastError: `meta_http_error: prior ${PUBLICATION_CRON_SAFE_RETRY_PROOF}`,
    }),
  );
  const publication = await store.getPublication(publicationId);
  assert.ok(publication);
  const originalPublish = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async () => ({
    ok: false,
    provider: "instagram",
    error: "meta_http_error: ECONNRESET",
    errorCode: "meta_http_error",
    retryable: true,
    providerInteractionStarted: true,
  });
  try {
    const failed = await publishPublication(store, publication!);
    assert.equal(failed.ambiguityState, "ambiguous");
    assert.equal(failed.lastError?.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF), false);
    assert.equal(isPublicationEligibleForCronAutoRetry(failed.lastError, failed), false);
  } finally {
    InstagramPublisher.prototype.publish = originalPublish;
  }
});

test("G: schedule and admin guards", async () => {
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store);
  await store.createPublication(basePublication({ status: "processing" }));
  await assert.rejects(
    () => scheduleApproved(store, "content-1", { scheduledFor: new Date().toISOString() }),
    PublicationScheduleBlockedError,
  );
  await store.createPublication(
    basePublication({
      id: "pub-amb",
      idempotencyKey: "k-amb",
      status: "failed",
      ambiguityState: "ambiguous",
    }),
  );
  await assert.rejects(
    () => scheduleApproved(store, "content-1", { scheduledFor: new Date().toISOString() }),
    PublicationScheduleBlockedError,
  );
  assert.equal((await retryAdminPublication(store, "pub-1")).status, 409);
  assert.equal((await retryAdminPublication(store, "pub-amb")).status, 409);
  await store.createPublication(
    basePublication({
      id: "pub-own",
      idempotencyKey: "k-own",
      status: "failed",
      ambiguityState: "owner_required",
    }),
  );
  assert.equal((await retryAdminPublication(store, "pub-own")).status, 409);
});

test("H: content-gate claim ownership", async () => {
  const store = new MemoryMarketingStore();
  await seedInstagramPublishable(store, "draft");
  const claimed = await store.claimPublication(
    (await store.createPublication(basePublication())).id,
  );
  assert.ok(claimed?.claimToken);
  const ownerToken = claimed!.claimToken!;
  const ownerPub = (await store.getPublication("pub-1"))!;
  const ownerResult = await publishPublication(store, { ...ownerPub, claimToken: ownerToken });
  assert.equal(ownerResult.status, "failed");
  assert.equal(ownerResult.lastError, "Content is not approved for publishing.");
  assert.equal(ownerResult.claimToken, null);

  await store.updateContent("content-1", { status: "draft" });
  const secondClaim = await store.claimPublication("pub-1");
  assert.ok(secondClaim?.claimToken);
  const staleResult = await publishPublication(store, {
    ...ownerPub,
    claimToken: ownerToken,
  });
  const current = await store.getPublication("pub-1");
  assert.equal(current?.claimToken, secondClaim?.claimToken);
  assert.equal(current?.status, "processing");
  assert.notEqual(staleResult.claimToken, ownerToken);
});
