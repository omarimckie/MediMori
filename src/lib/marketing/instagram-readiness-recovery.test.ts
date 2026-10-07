import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createMemoryIncidentRepository } from "./incidents/memory-repository";
import { setMarketingIncidentRepositoryForTests } from "./incidents/runtime-repository";
import { publishPublication, scheduleApproved } from "./approval";
import { ensureCatalogAssets } from "./assets";
import { MemoryMarketingStore } from "./memory-store";
import { seedMarketing } from "./seed";
import { INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS } from "./instagram-media-publish";
import { InstagramPublisher } from "./publishers";
import { PUBLICATION_CRON_SAFE_RETRY_PROOF } from "./publication-cron-retry";
import { isPublicationEligibleForCronAutoRetry } from "./publication-cron-retry";
import { PublicationScheduleBlockedError } from "./publication-ambiguity/schedule-error";
import { retryAdminPublication } from "./publication-retry";
import { contentReviewInstagramRecoveryNotice } from "./publication-recovery-display";
import {
  isInstagramProviderMediaRecoveryRequired,
} from "./publication-recovery-guard";
import { PUBLICATION_PROVIDER_INFLIGHT_MARKER } from "./publication-ambiguity/provider-inflight";
import type { MarketingContent, MarketingPublication } from "./types";

const originalMock = process.env.MARKETING_MOCK_MODE;

beforeEach(() => {
  setMarketingIncidentRepositoryForTests(createMemoryIncidentRepository());
});

afterEach(() => {
  setMarketingIncidentRepositoryForTests(null);
  process.env.MARKETING_MOCK_MODE = originalMock;
});

async function seedInstagramContent(store: MemoryMarketingStore, contentId = "content-ig") {
  const campaignId = "camp-ig-recovery";
  await store.createCampaign({
    id: campaignId,
    name: "Recovery test",
    objective: "Test",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "Test",
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
  const assets = await ensureCatalogAssets(store);
  const cover = assets.find((a) => a.url === "/covers/sickle-cell.png");
  assert.ok(cover);
  const content: MarketingContent = {
    id: contentId,
    campaignId,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "T",
    body: "Body",
    cta: "Cta",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [cover.id],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createContent(content);
  return { campaignId, contentId };
}

function failedInstagramWithContainer(
  overrides: Partial<MarketingPublication> = {},
): MarketingPublication {
  return {
    id: "pub-recovery",
    contentId: "content-ig",
    campaignId: "camp-ig-recovery",
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: "pub:content-ig:instagram",
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "meta_media_not_ready: not ready",
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: "container-meta-123",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("failed Instagram with provider_creation_id blocks admin retry explicitly", async () => {
  const store = new MemoryMarketingStore();
  await seedInstagramContent(store);
  await store.createPublication(failedInstagramWithContainer());
  let metaCalls = 0;
  const original = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async function () {
    metaCalls += 1;
    return { ok: true, provider: "instagram", externalId: "x" };
  };
  try {
    const result = await retryAdminPublication(store, "pub-recovery");
    assert.equal(result.status, 409);
    assert.equal(result.body.error?.code, "publication_recovery_required");
    assert.equal(metaCalls, 0);
    const row = await store.getPublication("pub-recovery");
    assert.equal(row?.providerCreationId, "container-meta-123");
  } finally {
    InstagramPublisher.prototype.publish = original;
  }
});

test("failed Instagram with provider_creation_id blocks scheduleApproved", async () => {
  const store = new MemoryMarketingStore();
  const { contentId } = await seedInstagramContent(store);
  await store.createPublication(failedInstagramWithContainer({ contentId }));
  await assert.rejects(
    () =>
      scheduleApproved(store, contentId, {
        scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
      }),
    PublicationScheduleBlockedError,
  );
  const row = await store.getPublication("pub-recovery");
  assert.equal(row?.providerCreationId, "container-meta-123");
  assert.equal(row?.status, "failed");
});

test("failed Instagram without provider_creation_id still allows mock retry", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const { contentId } = await seedInstagramContent(store, "content-ig-plain");
  await store.createPublication(
    failedInstagramWithContainer({
      id: "pub-plain",
      contentId: "content-ig-plain",
      providerCreationId: null,
      idempotencyKey: "idem-plain",
      attemptCount: 1,
      lastError: "mock failure",
    }),
  );
  const result = await retryAdminPublication(store, "pub-plain");
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
});

test("publishPublication does not call Meta when failed row retains provider_creation_id", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  await seedInstagramContent(store);
  const pub = failedInstagramWithContainer();
  await store.createPublication(pub);
  let metaCalls = 0;
  const original = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async function () {
    metaCalls += 1;
    return { ok: true, provider: "instagram", externalId: "ig-1" };
  };
  try {
    const out = await publishPublication(store, pub);
    assert.equal(out.id, "pub-recovery");
    assert.equal(out.status, "failed");
    assert.equal(metaCalls, 0);
  } finally {
    InstagramPublisher.prototype.publish = original;
  }
});

test("exhausted meta_media_not_ready via publishPublication retains provider_creation_id", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = "token";
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent({ platform: "instagram", status: "needs_review" }))[0];
  assert.ok(item);
  const asset = await store.createAsset({
    id: crypto.randomUUID(),
    name: "Public test image",
    type: "cover",
    source: "catalog",
    bookId: item.bookId,
    characterId: null,
    campaignId: item.campaignId,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1080:1080",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: ["test"],
    url: "https://twilight-feather.vercel.app/instagram-api-test.png",
    altText: "API test",
    isDemo: true,
  });
  await store.updateContent(item.id, { status: "approved", assetIds: [asset.id] });
  const publication = await scheduleApproved(store, item.id, {
    scheduledFor: new Date(Date.now() - 120_000).toISOString(),
  });
  const containerId = "c-flow-exhaust";
  const notReadyBody = {
    error: {
      message: "The media is not ready for publishing, please wait for a moment",
      code: 9007,
    },
  };
  let mediaCreatePosts = 0;
  let publishAttempts = 0;
  const publishCreationIds: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      init?.body != null ? new URLSearchParams(String(init.body)) : undefined;
    if (method === "POST" && url.endsWith("/media") && !url.endsWith("/media_publish")) {
      mediaCreatePosts += 1;
      return new Response(JSON.stringify({ id: containerId }), { status: 200 });
    }
    if (method === "GET" && url.includes(containerId) && url.includes("status_code")) {
      return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/media_publish")) {
      publishAttempts += 1;
      publishCreationIds.push(body?.get("creation_id") ?? "");
      return new Response(JSON.stringify(notReadyBody), { status: 400 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const failed = await publishPublication(store, publication);
    assert.equal(failed.status, "failed");
    assert.match(failed.lastError ?? "", /meta_media_not_ready/);
    assert.equal(mediaCreatePosts, 1);
    assert.equal(publishAttempts, INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS);
    assert.equal(publishCreationIds.length, INSTAGRAM_MEDIA_PUBLISH_NOT_READY_MAX_ATTEMPTS);
    for (const creationId of publishCreationIds) {
      assert.equal(creationId, containerId);
    }
    assert.equal(failed.providerCreationId, containerId);
    assert.equal(isPublicationEligibleForCronAutoRetry(failed.lastError, failed), false);
    assert.equal(failed.lastError?.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inflight sentinel is not Instagram provider media recovery required", () => {
  const pub = failedInstagramWithContainer({
    providerCreationId: PUBLICATION_PROVIDER_INFLIGHT_MARKER,
  });
  assert.equal(isInstagramProviderMediaRecoveryRequired(pub), false);
  assert.equal(contentReviewInstagramRecoveryNotice(pub), null);
});

test("contentReviewInstagramRecoveryNotice surfaces owner copy", () => {
  assert.equal(
    contentReviewInstagramRecoveryNotice(failedInstagramWithContainer()),
    contentReviewInstagramRecoveryNotice(failedInstagramWithContainer()),
  );
  assert.ok(contentReviewInstagramRecoveryNotice(failedInstagramWithContainer())?.includes("Owner recovery"));
  assert.equal(
    contentReviewInstagramRecoveryNotice(
      failedInstagramWithContainer({ providerCreationId: null }),
    ),
    null,
  );
});
