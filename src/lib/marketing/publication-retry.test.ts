import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { NextResponse } from "next/server";
import { MemoryMarketingStore } from "./memory-store";
import { ensureCatalogAssets } from "./assets";
import { handleAdminPublicationRetryRequest } from "./publication-retry-http";
import {
  retryFailedInstagramPublication,
  type PublicationRetryResponseBody,
} from "./publication-retry";
import type { MarketingContent, MarketingPublication } from "./types";

const originalMock = process.env.MARKETING_MOCK_MODE;

afterEach(() => {
  process.env.MARKETING_MOCK_MODE = originalMock;
});

function assertNoSecrets(body: PublicationRetryResponseBody) {
  const json = JSON.stringify(body);
  assert.equal(json.includes("access_token"), false);
  assert.equal(json.includes("META_INSTAGRAM"), false);
  assert.equal(json.includes("Bearer "), false);
}

async function seedFailedInstagramPublication(store: MemoryMarketingStore) {
  const campaignId = "camp-retry-test";
  const contentId = "content-ig-failed";
  const publicationId = "pub-ig-failed";

  await store.createCampaign({
    id: campaignId,
    name: "Retry test",
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
  assert.ok(sickleCover, "catalog sickle cell cover asset");

  const content: MarketingContent = {
    id: contentId,
    campaignId,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "failed",
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
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createContent(content);

  const publication: MarketingPublication = {
    id: publicationId,
    contentId,
    campaignId,
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: "idem-ig-failed",
    externalId: null,
    url: null,
    attemptCount: 2,
    lastError: "meta_auth_expired: prior attempt",
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createPublication(publication);

  return { publicationId, contentId };
}

test("unauthenticated request is rejected", async () => {
  const store = new MemoryMarketingStore();
  const response = await handleAdminPublicationRetryRequest({
    publicationId: "any",
    auth: {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      username: null,
    },
    store,
  });
  assert.equal(response.status, 401);
});

test("nonexistent publication is rejected", async () => {
  const store = new MemoryMarketingStore();
  const result = await retryFailedInstagramPublication(store, "missing-id");
  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error?.code, "publication_not_found");
  assertNoSecrets(result.body);
});

test("non-Instagram publication is rejected", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication({
    id: "pub-fb",
    contentId: "c1",
    campaignId: "camp",
    platform: "facebook",
    provider: "facebook",
    status: "failed",
    idempotencyKey: "k",
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "err",
    scheduledFor: null,
    publishedAt: null,
  });
  const result = await retryFailedInstagramPublication(store, "pub-fb");
  assert.equal(result.status, 400);
  assert.equal(result.body.error?.code, "unsupported_platform");
});

test("non-failed publication is rejected", async () => {
  const store = new MemoryMarketingStore();
  await store.createPublication({
    id: "pub-scheduled",
    contentId: "c1",
    campaignId: "camp",
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: "k",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: null,
    publishedAt: null,
  });
  const result = await retryFailedInstagramPublication(store, "pub-scheduled");
  assert.equal(result.status, 400);
  assert.equal(result.body.error?.code, "invalid_publication_status");
});

test("preflight failure prevents publisher call", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const { publicationId, contentId } = await seedFailedInstagramPublication(store);
  await store.updateContent(contentId, { assetIds: [] });

  const before = await store.getPublication(publicationId);
  const result = await retryFailedInstagramPublication(store, publicationId);
  assert.equal(result.status, 422);
  assert.equal(result.body.preflight?.code, "image_missing");
  const after = await store.getPublication(publicationId);
  assert.equal(after?.attemptCount, before?.attemptCount);
  assert.equal(after?.lastError, before?.lastError);
  assertNoSecrets(result.body);
});

test("valid failed Instagram publication reaches existing retry workflow", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const { publicationId } = await seedFailedInstagramPublication(store);

  const otherPub: MarketingPublication = {
    id: "pub-other-scheduled",
    contentId: "other-content",
    campaignId: "camp-retry-test",
    platform: "facebook",
    provider: "facebook",
    status: "scheduled",
    idempotencyKey: "other",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createPublication(otherPub);

  const result = await retryFailedInstagramPublication(store, publicationId);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.ok(result.body.external_id);
  assert.equal(result.body.platform, "instagram");

  const untouched = await store.getPublication("pub-other-scheduled");
  assert.equal(untouched?.status, "scheduled");
  assert.equal(untouched?.attemptCount, 0);
  assertNoSecrets(result.body);
});

test("retry handler does not import bulk publish scheduler", () => {
  const sources = [
    "src/lib/marketing/publication-retry.ts",
    "src/lib/marketing/publication-retry-http.ts",
    "src/app/api/admin/marketing/publications/[publicationId]/retry/route.ts",
  ];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.equal(/\bpublishDue\b/.test(text), false, `${file} must not call bulk publishDue`);
  }
});

test("authenticated handler returns non-secret JSON", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const { publicationId } = await seedFailedInstagramPublication(store);
  const response = await handleAdminPublicationRetryRequest({
    publicationId,
    auth: { ok: true, response: null, username: "omari" },
    store,
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as PublicationRetryResponseBody;
  assertNoSecrets(body);
  assert.equal(body.publicationId, publicationId);
});
