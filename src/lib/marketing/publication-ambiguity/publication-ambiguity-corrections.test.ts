import assert from "node:assert/strict";
import { test } from "node:test";
import { publishDue, publishPublication, scheduleApproved } from "../approval";
import { ensureCatalogAssets } from "../assets";
import { MemoryMarketingStore } from "../memory-store";
import { FacebookPagePublisher, InstagramPublisher } from "../publishers";
import {
  formatPublicationFailureLastError,
  isPublicationEligibleForCronAutoRetry,
  PUBLICATION_CRON_SAFE_RETRY_PROOF,
} from "../publication-cron-retry";
import { classifyProviderPublishResult } from "./classify";
import { retryAdminPublication } from "../publication-retry";
import { PublicationScheduleBlockedError } from "./schedule-error";
import { handleProviderSuccessAfterLostFinalize } from "./lost-claim-success";
import { notifyPublicationAmbiguousOutcome } from "./notify";
import { PUBLICATION_PROVIDER_INFLIGHT_MARKER } from "./provider-inflight";
import type { MarketingContent, MarketingPublication } from "../types";

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

async function seedContent(store: MemoryMarketingStore, platform: "instagram" | "facebook" = "instagram") {
  const assets = await ensureCatalogAssets(store);
  const cover = assets.find((a) => a.url === "/covers/sickle-cell.png");
  assert.ok(cover);
  const content: MarketingContent = {
    id: "content-1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform,
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
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
  await store.createContent(content);
  return content;
}

test("stale worker cannot finalize after actual claim token superseded", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication());
  const first = await store.claimPublication("pub-1");
  assert.ok(first?.claimToken);
  await store.updatePublication("pub-1", { claimToken: "newer-owner-token" });
  const finalized = await store.finalizePublicationClaim({
    id: "pub-1",
    claimToken: first!.claimToken!,
    patch: { status: "published", externalId: "stale-id" },
  });
  assert.equal(finalized, null);
  const row = await store.getPublication("pub-1");
  assert.equal(row?.claimToken, "newer-owner-token");
  assert.notEqual(row?.externalId, "stale-id");
});

test("lost claim provider success does not overwrite newer published external_id", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(
    basePublication({
      status: "published",
      externalId: "authoritative-y",
      claimToken: null,
    }),
  );
  const outcome = await handleProviderSuccessAfterLostFinalize(store, {
    publication: basePublication({ status: "processing", claimToken: "stale-a" }),
    claimToken: "stale-a",
    attemptCount: 1,
    result: { ok: true, provider: "instagram", externalId: "stale-x" },
    publishedAt: new Date().toISOString(),
  });
  assert.equal(outcome.externalId, "authoritative-y");
  assert.equal(outcome.status, "published");
});

test("same claim token concurrent provider entry allows only one inflight marker", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication({ status: "processing", claimToken: "t1" }));
  const [a, b] = await Promise.all([
    store.tryBeginProviderPublish({ id: "pub-1", claimToken: "t1" }),
    store.tryBeginProviderPublish({ id: "pub-1", claimToken: "t1" }),
  ]);
  assert.equal(a !== b, true);
  assert.equal(Boolean(a) !== Boolean(b), true);
  const row = await store.getPublication("pub-1");
  assert.equal(row?.providerCreationId, PUBLICATION_PROVIDER_INFLIGHT_MARKER);
});

test("concurrent publishPublication with same claim invokes provider at most once", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  await seedContent(store);
  const claimed = await store.claimPublication(
    (await store.createPublication(basePublication())).id,
  );
  assert.ok(claimed?.claimToken);
  let calls = 0;
  const original = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async function () {
    calls += 1;
    return { ok: true, provider: "instagram", externalId: "ig-1", providerInteractionStarted: true };
  };
  try {
    const pub = (await store.getPublication("pub-1"))!;
    await Promise.all([
      publishPublication(store, pub),
      publishPublication(store, pub),
    ]);
    assert.equal(calls <= 1, true);
  } finally {
    InstagramPublisher.prototype.publish = original;
  }
});

test("preflight failure remains non-ambiguous", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
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
    bookIds: [],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: true,
  });
  await store.createContent({
    id: "content-1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "T",
    body: "B",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: true,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  });
  const pub = await store.createPublication(basePublication());
  const failed = await publishPublication(store, pub);
  assert.equal(failed.status, "failed");
  assert.equal(failed.ambiguityState ?? "none", "none");
});

test("scheduleApproved refuses ambiguous publication", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedContent(store);
  await store.createPublication(
    basePublication({ status: "failed", ambiguityState: "ambiguous" }),
  );
  await assert.rejects(
    () => scheduleApproved(store, "content-1", { scheduledFor: new Date().toISOString() }),
    PublicationScheduleBlockedError,
  );
});

test("admin retry rejects processing and owner_required", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication({ status: "processing" }));
  assert.equal((await retryAdminPublication(store, "pub-1")).status, 409);
  await store.createPublication(
    basePublication({ id: "pub-2", idempotencyKey: "k2", status: "failed", ambiguityState: "owner_required" }),
  );
  assert.equal((await retryAdminPublication(store, "pub-2")).status, 409);
});

test("legacy cron marker without safe proof is not publishDue eligible", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedContent(store);
  await store.createPublication(
    basePublication({
      status: "failed",
      attemptCount: 1,
      lastError: "meta_http_error: x [cron_auto_retryable]",
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

test("Instagram container timeout through publisher preserves ambiguous classification path", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "c-timeout" }), { status: 200 });
    }
    if (method === "GET" && url.includes("c-timeout")) {
      return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  const publisher = new InstagramPublisher({
    credentials: { userId: "u", accessToken: "t", graphVersion: "v22.0" },
    fetch: fetchImpl,
    sleep: async () => {},
  });
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication({ status: "processing", claimToken: "c1" }));
  await store.tryBeginProviderPublish({ id: "pub-1", claimToken: "c1" });
  const content = await seedContent(store);
  const result = await publisher.publish({
    content,
    publication: (await store.getPublication("pub-1"))!,
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
    hooks: {
      onProviderCreationId: (id) =>
        store.persistProviderCreationId({ id: "pub-1", claimToken: "c1", providerCreationId: id }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_container_status_timeout");
  const row = await store.getPublication("pub-1");
  assert.equal(row?.providerCreationId, "c-timeout");
});

test("creation id persistence failure prevents media_publish", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if ((init?.method ?? "GET").toUpperCase() === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
    }
    if (url.endsWith("/media_publish")) {
      throw new Error("should not publish");
    }
    return new Response("{}", { status: 404 });
  };
  const publisher = new InstagramPublisher({
    credentials: { userId: "u", accessToken: "t", graphVersion: "v22.0" },
    fetch: fetchImpl,
  });
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication({ status: "processing", claimToken: "c1" }));
  await store.tryBeginProviderPublish({ id: "pub-1", claimToken: "c1" });
  const content = await seedContent(store);
  const result = await publisher.publish({
    content,
    publication: (await store.getPublication("pub-1"))!,
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
    hooks: {
      onProviderCreationId: async () => false,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "publication_creation_id_persist_failed");
});

test("Facebook transport ambiguity blocks automatic cron retry", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  await seedContent(store, "facebook");
  await store.createPublication(
    basePublication({
      platform: "facebook",
      provider: "facebook_page",
      status: "failed",
      ambiguityState: "ambiguous",
      attemptCount: 1,
      lastError: "meta_http_error: ECONNRESET",
    }),
  );
  const fetchImpl: typeof fetch = async () => {
    throw new Error("ECONNRESET");
  };
  const publisher = new FacebookPagePublisher({
    credentials: { pageId: "p", pageAccessToken: "t", graphVersion: "v22.0" },
    fetch: fetchImpl,
  });
  let fbCalls = 0;
  const original = FacebookPagePublisher.prototype.publish;
  FacebookPagePublisher.prototype.publish = async function (req) {
    fbCalls += 1;
    return publisher.publish(req);
  };
  try {
    await publishDue(store);
    assert.equal(fbCalls, 0);
  } finally {
    FacebookPagePublisher.prototype.publish = original;
  }
  const transport = await new FacebookPagePublisher({
    credentials: { pageId: "p", pageAccessToken: "t", graphVersion: "v22.0" },
    fetch: fetchImpl,
  }).publish({
    content: (await store.getContent("content-1"))!,
    publication: basePublication({ platform: "facebook", provider: "facebook_page" }),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(transport.ok, false);
  assert.equal(transport.providerInteractionStarted, true);
  assert.equal(
    classifyProviderPublishResult(transport, { providerInteractionStarted: true }),
    "ambiguous",
  );
});

test("Facebook provider success after lost finalize cannot overwrite newer publish", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(
    basePublication({
      platform: "facebook",
      provider: "facebook_page",
      status: "published",
      externalId: "fb-new",
      claimToken: null,
    }),
  );
  const outcome = await handleProviderSuccessAfterLostFinalize(store, {
    publication: basePublication({
      platform: "facebook",
      provider: "facebook_page",
      status: "processing",
      claimToken: "stale",
    }),
    claimToken: "stale",
    attemptCount: 1,
    result: { ok: true, provider: "facebook_page", externalId: "fb-stale" },
    publishedAt: new Date().toISOString(),
  });
  assert.equal(outcome.externalId, "fb-new");
});

test("outcome ambiguity notify uses dedupe path without throwing", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(
    basePublication({ status: "failed", ambiguityState: "ambiguous" }),
  );
  const pub = (await store.getPublication("pub-1"))!;
  await notifyPublicationAmbiguousOutcome(pub, "test");
});

test("confirmed safe retry proof remains eligible", () => {
  const err = formatPublicationFailureLastError("mock transient", true);
  assert.ok(err.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF));
  assert.equal(isPublicationEligibleForCronAutoRetry(err), true);
});
