import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { publishDue, publishPublication } from "./approval";
import { ensureCatalogAssets } from "./assets";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingContent } from "./types";
import {
  formatPublicationFailureLastError,
  isPublicationEligibleForCronAutoRetry,
  PUBLICATION_CRON_AUTO_RETRY_MARKER,
  PUBLICATION_CRON_SAFE_RETRY_PROOF,
  shouldStampCronAutoRetryForPlatform,
} from "./publication-cron-retry";

const originalMock = process.env.MARKETING_MOCK_MODE;

afterEach(() => {
  process.env.MARKETING_MOCK_MODE = originalMock;
});

test("isPublicationEligibleForCronAutoRetry rejects legacy transient without structured proof", () => {
  assert.equal(
    isPublicationEligibleForCronAutoRetry(
      "meta_http_error: transient Meta API failure. rate limit",
    ),
    false,
  );
  assert.equal(
    isPublicationEligibleForCronAutoRetry(
      `meta_http_error: failed ${PUBLICATION_CRON_AUTO_RETRY_MARKER}`,
    ),
    false,
  );
});

test("isPublicationEligibleForCronAutoRetry accepts Phase 2A safe retry proof", () => {
  const stamped = formatPublicationFailureLastError("meta_http_error: ECONNRESET", true);
  assert.ok(stamped.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF));
  assert.equal(isPublicationEligibleForCronAutoRetry(stamped), true);
});

test("formatPublicationFailureLastError does not strip proof when error is long", () => {
  const raw =
    "meta_http_error: upstream timeout after 30s (code=504) — see graph batch /foo?bar=1";
  const stamped = formatPublicationFailureLastError(raw, true);
  assert.equal(isPublicationEligibleForCronAutoRetry(stamped), true);
  assert.ok(stamped.startsWith(raw));
});

test("isPublicationEligibleForCronAutoRetry rejects non-retryable Meta errors", () => {
  assert.equal(
    isPublicationEligibleForCronAutoRetry(
      "meta_invalid_image_aspect_ratio: aspect ratio not valid",
    ),
    false,
  );
  assert.equal(
    isPublicationEligibleForCronAutoRetry("meta_http_error: permission denied"),
    false,
  );
  assert.equal(
    isPublicationEligibleForCronAutoRetry("meta_auth_expired: token expired"),
    false,
  );
});

test("shouldStampCronAutoRetryForPlatform is Meta-only", () => {
  assert.equal(shouldStampCronAutoRetryForPlatform("instagram", true), true);
  assert.equal(shouldStampCronAutoRetryForPlatform("facebook", true), true);
  assert.equal(shouldStampCronAutoRetryForPlatform("pinterest", true), false);
  assert.equal(shouldStampCronAutoRetryForPlatform("instagram", false), false);
});

async function seedInstagramFailedForCronRetry(
  store: MemoryMarketingStore,
  input: {
    suffix: string;
    publicationId: string;
    lastError: string | null;
    attemptCount: number;
    contentStatus?: MarketingContent["status"];
    imageUrl?: string;
  },
) {
  const campaignId = `camp-cron-retry-${input.suffix}`;
  const contentId = `content-cron-retry-${input.suffix}`;
  await store.createCampaign({
    id: campaignId,
    name: "Cron retry test",
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
  const sickleCover = assets.find((asset) => asset.url === "/covers/sickle-cell.png");
  assert.ok(sickleCover);
  if (input.imageUrl) {
    await store.updateAsset(sickleCover.id, { url: input.imageUrl });
  }
  const content: MarketingContent = {
    id: contentId,
    campaignId,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: input.contentStatus ?? "failed",
    title: "Test",
    body: "Warm copy for sickle cell.",
    cta: "Read",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [sickleCover.id],
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
  await store.createPublication({
    id: input.publicationId,
    contentId,
    campaignId,
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: `idem-${input.publicationId}`,
    externalId: null,
    url: null,
    attemptCount: input.attemptCount,
    lastError: input.lastError,
    scheduledFor: null,
    publishedAt: null,
  });
}

test("publishDue selects stamped Meta network-style failure", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const publicationId = "pub-meta-network-retry";
  await seedInstagramFailedForCronRetry(store, {
    suffix: "network",
    publicationId,
    attemptCount: 1,
    lastError: formatPublicationFailureLastError("meta_http_error: ECONNRESET", true),
  });

  const results = await publishDue(store);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, publicationId);
});

test("publishPublication marks Meta transport failure as ambiguous without cron marker", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = "ig-token";
  const store = new MemoryMarketingStore();
  const publicationId = "pub-stamp-network";
  await seedInstagramFailedForCronRetry(store, {
    suffix: "stamp",
    publicationId,
    attemptCount: 0,
    lastError: null,
    contentStatus: "approved",
    imageUrl: "https://twilight-feather.vercel.app/instagram-api-test.png",
  });
  const publication = await store.getPublication(publicationId);
  assert.ok(publication);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  try {
    const failed = await publishPublication(store, publication);
    assert.equal(failed.status, "failed");
    assert.equal(failed.ambiguityState, "ambiguous");
    assert.ok(failed.lastError?.includes("meta_http_error:"));
    assert.equal(failed.lastError?.includes(PUBLICATION_CRON_AUTO_RETRY_MARKER), false);
    assert.equal(isPublicationEligibleForCronAutoRetry(failed.lastError, failed), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publishPublication persists cron marker for confirmed retryable mock failure", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const publicationId = "pub-mock-retry-marker";
  await seedInstagramFailedForCronRetry(store, {
    suffix: "mock-marker",
    publicationId,
    attemptCount: 0,
    lastError: null,
    contentStatus: "approved",
  });
  const publication = await store.getPublication(publicationId);
  assert.ok(publication);
  const failed = await publishPublication(store, publication, { simulateFailure: true });
  assert.equal(failed.status, "failed");
  assert.ok(failed.lastError?.includes(PUBLICATION_CRON_SAFE_RETRY_PROOF));
  assert.equal(isPublicationEligibleForCronAutoRetry(failed.lastError, failed), true);
});

test("publishDue does not select legacy transient failure without structured proof", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const publicationId = "pub-meta-transient-legacy";
  await seedInstagramFailedForCronRetry(store, {
    suffix: "legacy-transient",
    publicationId,
    attemptCount: 1,
    lastError: "meta_http_error: transient Meta API failure. rate limited",
  });

  const results = await publishDue(store);
  assert.equal(results.length, 0);
});

test("publishDue excludes non-retryable Meta failure without marker", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createPublication({
    id: "pub-meta-aspect-fail",
    contentId: "content-1",
    campaignId: "camp-1",
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: "idem-aspect-fail",
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "meta_invalid_image_aspect_ratio: invalid aspect ratio",
    scheduledFor: null,
    publishedAt: null,
  });

  const results = await publishDue(store);
  assert.equal(results.length, 0);
});

test("publishDue excludes Pinterest retryable errors without transient or marker", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createPublication({
    id: "pub-pinterest-rate",
    contentId: "content-p",
    campaignId: "camp-1",
    platform: "pinterest",
    provider: "pinterest",
    status: "failed",
    idempotencyKey: "idem-pinterest",
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "pinterest_rate_limit: too many requests",
    scheduledFor: null,
    publishedAt: null,
  });

  const results = await publishDue(store);
  assert.equal(results.length, 0);
});

test("publishDue still excludes attempt_count >= 3 with marker", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createPublication({
    id: "pub-exhausted-marker",
    contentId: "content-1",
    campaignId: "camp-1",
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: "idem-exhausted-marker",
    externalId: null,
    url: null,
    attemptCount: 3,
    lastError: formatPublicationFailureLastError("meta_http_error: ECONNRESET", true),
    scheduledFor: null,
    publishedAt: null,
  });

  const results = await publishDue(store);
  assert.equal(results.length, 0);
});

test("publishDue does not pick future scheduled publications (only failed retry queue)", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await store.createPublication({
    id: "pub-future-scheduled",
    contentId: "content-missing",
    campaignId: "camp-1",
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: "idem-future",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: future,
    publishedAt: null,
  });

  const results = await publishDue(store);
  assert.equal(results.length, 0);
});
