import assert from "node:assert/strict";
import { test } from "node:test";
import {
  publishDue,
  publishPublication,
  scheduleApproved,
} from "../approval";
import { MemoryMarketingStore } from "../memory-store";
import { isPublicationEligibleForCronAutoRetry } from "../publication-cron-retry";
import { InstagramPublisher } from "../publishers";
import { retryAdminPublication } from "../publication-retry";
import { PublicationScheduleBlockedError } from "./schedule-error";
import type { MarketingContent, MarketingPublication } from "../types";
import { ensureCatalogAssets } from "../assets";

function basePublication(
  overrides: Partial<MarketingPublication> = {},
): MarketingPublication {
  return {
    id: "pub-1",
    contentId: "content-1",
    campaignId: "camp",
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: "idem-1",
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

test("claim assigns token and processing_started_at", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication());
  const claimed = await store.claimPublication("pub-1");
  assert.ok(claimed?.claimToken);
  assert.ok(claimed?.processingStartedAt);
  assert.equal(claimed?.status, "processing");
});

test("concurrent claim allows only one owner", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication());
  const [a, b] = await Promise.all([
    store.claimPublication("pub-1"),
    store.claimPublication("pub-1"),
  ]);
  assert.equal(Boolean(a) !== Boolean(b), true);
});

test("stale worker cannot finalize after claim token changes", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication());
  const first = await store.claimPublication("pub-1");
  assert.ok(first?.claimToken);
  const second = await store.claimPublication("pub-1");
  assert.equal(second, null);
  const finalized = await store.finalizePublicationClaim({
    id: "pub-1",
    claimToken: "wrong-token",
    patch: { status: "published", externalId: "x" },
  });
  assert.equal(finalized, null);
});

test("ambiguous failure is not cron retry eligible", () => {
  const pub = basePublication({
    status: "failed",
    ambiguityState: "ambiguous",
    lastError: "meta_http_error: x [cron_safe_retry:v1]",
  });
  assert.equal(isPublicationEligibleForCronAutoRetry(pub.lastError, pub), false);
});

test("publishDue skips ambiguous failed publication", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedContent(store);
  await store.createPublication(
    basePublication({
      status: "failed",
      ambiguityState: "ambiguous",
      lastError: "meta_http_error: reset [cron_safe_retry:v1]",
      attemptCount: 1,
    }),
  );
  const calls: string[] = [];
  const original = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async function () {
    calls.push("meta");
    return { ok: true, provider: "instagram", externalId: "ig-1" };
  };
  try {
    await publishDue(store);
    assert.equal(calls.length, 0);
  } finally {
    InstagramPublisher.prototype.publish = original;
  }
});

test("processing publication passed to publishPublication does not call Meta", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  const store = new MemoryMarketingStore();
  await seedContent(store);
  const pub = basePublication({
    status: "processing",
    claimToken: "other-worker",
    updatedAt: new Date().toISOString(),
  });
  await store.createPublication(pub);
  let called = false;
  const original = InstagramPublisher.prototype.publish;
  InstagramPublisher.prototype.publish = async function () {
    called = true;
    return { ok: true, provider: "instagram", externalId: "ig-1" };
  };
  try {
    await publishPublication(store, pub);
    assert.equal(called, false);
  } finally {
    InstagramPublisher.prototype.publish = original;
  }
});

test("scheduleApproved refuses processing publication", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await seedContent(store);
  await store.createPublication(
    basePublication({
      status: "processing",
      idempotencyKey: "pub:content-1:instagram",
    }),
  );
  await assert.rejects(
    () => scheduleApproved(store, "content-1", { scheduledFor: new Date().toISOString() }),
    PublicationScheduleBlockedError,
  );
});

test("admin retry rejects ambiguous publication", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(
    basePublication({
      status: "failed",
      platform: "instagram",
      ambiguityState: "ambiguous",
    }),
  );
  const result = await retryAdminPublication(store, "pub-1");
  assert.equal(result.status, 409);
  assert.equal(result.body.error?.code, "publication_retry_blocked");
});

test("Instagram persists container id before media_publish", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication(basePublication({ status: "processing", claimToken: "claim-1" }));
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/media")) {
      return new Response(JSON.stringify({ id: "container-abc" }), { status: 200 });
    }
    if (method === "GET" && url.includes("container-abc")) {
      return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/media_publish")) {
      const row = await store.getPublication("pub-1");
      assert.equal(row?.providerCreationId, "container-abc");
      return new Response(JSON.stringify({ id: "media-1" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  const publisher = new InstagramPublisher({
    credentials: { userId: "u", accessToken: "t", graphVersion: "v22.0" },
    fetch: fetchImpl,
    sleep: async () => {},
  });
  const content = await seedContent(store);
  const pub = (await store.getPublication("pub-1"))!;
  const result = await publisher.publish({
    content,
    publication: pub,
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
    hooks: {
      onProviderCreationId: (id) =>
        store.persistProviderCreationId({
          id: pub.id,
          claimToken: "claim-1",
          providerCreationId: id,
        }),
    },
  });
  assert.equal(result.ok, true);
});
