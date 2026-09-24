import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { approveContent, scheduleApproved } from "./approval";
import { MemoryMarketingStore } from "./memory-store";
import {
  clearPinterestTokenCacheForTests,
  createPinterestPin,
  getPinterestCredentials,
  refreshPinterestAccessToken,
} from "./pinterest";
import { PinterestPublisher } from "./pinterest-publisher";
import { getSocialPublisher } from "./publishers";
import { runPublishPreflight } from "./publish-preflight";
import {
  PINTEREST_ASPECT_RATIO_MAX,
  PINTEREST_ASPECT_RATIO_MIN,
  PINTEREST_MIN_IMAGE_WIDTH,
} from "./platform-suitability";
import { retryAdminPublication } from "./publication-retry";
import { buildPublishTrackingLink, trackingDestinationPath } from "./tracking";
import type { MarketingContent } from "./types";

const PINTEREST_ENV = {
  PINTEREST_CLIENT_ID: "client",
  PINTEREST_CLIENT_SECRET: "secret",
  PINTEREST_REFRESH_TOKEN: "pinr_refresh_token",
  PINTEREST_BOARD_ID: "1113655882796897267",
};

const originalEnv = { ...process.env };

function fetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

afterEach(() => {
  process.env = { ...originalEnv };
  clearPinterestTokenCacheForTests();
});

function samplePinterestContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "pin-content",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "pinterest",
    format: "pin",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "Gentle sickle cell story",
    body: "A kind conversation starter for families.",
    cta: "Visit the book page",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "abc123tracking",
    originalBody: null,
    bookId: "book-one",
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("getSocialPublisher pinterest returns MockSocialPublisher in mock mode", () => {
  process.env.MARKETING_MOCK_MODE = "true";
  assert.equal(getSocialPublisher("pinterest").id, "mock_social");
});

test("getSocialPublisher pinterest returns PinterestPublisher in live mode with credentials", () => {
  process.env.MARKETING_MOCK_MODE = "false";
  Object.assign(process.env, PINTEREST_ENV);
  assert.equal(getSocialPublisher("pinterest").id, "pinterest");
});

test("missing live Pinterest credentials fail closed on publish", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  delete process.env.PINTEREST_CLIENT_ID;
  const publisher = new PinterestPublisher({ credentials: null });
  const result = await publisher.publish({
    content: samplePinterestContent(),
    publication: {
      id: "pub",
      contentId: "pin-content",
      campaignId: "camp",
      platform: "pinterest",
      provider: "pinterest",
      status: "processing",
      idempotencyKey: "k",
      externalId: null,
      url: null,
      attemptCount: 0,
      lastError: null,
      scheduledFor: null,
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    imageUrl: "https://cdn.example.test/pin.png",
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /pinterest_credentials_missing/);
});

test("board ID comes from environment not hard-coded", () => {
  Object.assign(process.env, PINTEREST_ENV);
  const creds = getPinterestCredentials();
  assert.equal(creds?.boardId, "1113655882796897267");
  assert.notEqual(creds?.boardId, "HARDCODED");
});

test("OAuth token refresh request is correct", async () => {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = fetchInputUrl(input);
    calls.push({
      url,
      body: String(init?.body ?? ""),
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return new Response(JSON.stringify({ access_token: "access_xyz", expires_in: 3600 }), {
      status: 200,
    });
  };
  const result = await refreshPinterestAccessToken(
    {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "pinr_refresh",
      boardId: "board",
      boardSectionId: null,
    },
    fetchImpl,
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.url, "https://api.pinterest.com/v5/oauth/token");
  assert.match(calls[0]?.body ?? "", /grant_type=refresh_token/);
  assert.match(calls[0]?.headers.Authorization ?? "", /^Basic /);
});

test("Pin create uses POST /v5/pins with board and tracking link", async () => {
  const calls: Array<{ url: string; method: string; body: string; auth: string }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = fetchInputUrl(input);
    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "access_xyz", expires_in: 3600 }), {
        status: 200,
      });
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
      auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
    });
    return new Response(JSON.stringify({ id: "654321" }), { status: 201 });
  };

  const publisher = new PinterestPublisher({
    fetch: fetchImpl,
    credentials: {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "pinr",
      boardId: "1113655882796897267",
      boardSectionId: null,
    },
  });

  const content = samplePinterestContent({ metadata: { pinAltText: "Family reading" } });
  const result = await publisher.publish({
    content,
    publication: {
      id: "pub",
      contentId: content.id,
      campaignId: "camp",
      platform: "pinterest",
      provider: "pinterest",
      status: "processing",
      idempotencyKey: "k",
      externalId: null,
      url: null,
      attemptCount: 0,
      lastError: null,
      scheduledFor: null,
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    imageUrl: "https://cdn.example.test/pin.png",
  });

  assert.equal(result.ok, true);
  assert.equal(result.externalId, "654321");
  assert.equal(calls[0]?.url, "https://api.pinterest.com/v5/pins");
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.auth, /^Bearer access_xyz/);
  const payload = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
  assert.equal(payload.board_id, "1113655882796897267");
  assert.equal(payload.title, content.title);
  assert.equal(payload.description, "A kind conversation starter for families.\n\nVisit the book page");
  assert.equal(payload.alt_text, "Family reading");
  assert.match(String(payload.link), /\/api\/m\/abc123tracking/);
  assert.equal((payload.media_source as { url?: string }).url, "https://cdn.example.test/pin.png");
  assert.match(result.url ?? "", /654321|pinterest\.com\/pin/);
});

test("Pinterest API 401 is not retryable", async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = fetchInputUrl(input);
    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify({ message: "bad token" }), { status: 401 });
    }
    return new Response("{}", { status: 500 });
  };
  const publisher = new PinterestPublisher({
    fetch: fetchImpl,
    credentials: {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "pinr",
      boardId: "b",
      boardSectionId: null,
    },
  });
  const result = await publisher.publish({
    content: samplePinterestContent(),
    publication: {
      id: "pub",
      contentId: "pin-content",
      campaignId: "camp",
      platform: "pinterest",
      provider: "pinterest",
      status: "processing",
      idempotencyKey: "k",
      externalId: null,
      url: null,
      attemptCount: 0,
      lastError: null,
      scheduledFor: null,
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    imageUrl: "https://cdn.example.test/pin.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
});

test("Pinterest API 429 is retryable", async () => {
  const result = await createPinterestPin(
    "token",
    {
      boardId: "b",
      title: "t",
      description: "d",
      link: "https://example.com/api/m/x",
      imageUrl: "https://cdn.example.test/i.png",
    },
    async () => new Response(JSON.stringify({ message: "rate limit" }), { status: 429 }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
});

test("invalid Pinterest aspect ratio fails preflight", async () => {
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "wide",
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "800:200",
    imageWidth: 800,
    imageHeight: 200,
    mimeType: "image/png",
    tags: [],
    url: "https://cdn.example.test/wide.png",
    altText: "x",
    isDemo: false,
  });
  const content = samplePinterestContent({ status: "approved", assetIds: ["asset-1"] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, false);
});

test("valid Pinterest vertical image passes preflight", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "pin",
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1000:1500",
    imageWidth: 1000,
    imageHeight: 1500,
    mimeType: "image/png",
    tags: [],
    url: "https://cdn.example.test/pin.png",
    altText: "x",
    isDemo: false,
  });
  const content = samplePinterestContent({ status: "approved", assetIds: ["asset-1"] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, true);
});

test("buildPublishTrackingLink uses tracking token", () => {
  const content = samplePinterestContent();
  const link = buildPublishTrackingLink(content);
  assert.ok(link?.includes("/api/m/abc123tracking"));
  assert.equal(trackingDestinationPath(content), "/books/book-one");
});

test("retryAdminPublication supports Pinterest failed publications", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = samplePinterestContent({ status: "approved" });
  await store.createContent(content);
  await store.createAsset({
    id: "asset-1",
    name: "pin",
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "2:3",
    imageWidth: 1000,
    imageHeight: 1500,
    mimeType: "image/png",
    tags: [],
    url: "https://cdn.example.test/pin.png",
    altText: "x",
    isDemo: false,
  });
  await approveContent(store, content.id, "owner");
  const pub = await scheduleApproved(store, content.id);
  await store.updatePublication(pub.id, { status: "failed", lastError: "pinterest_rate_limit: slow down" });
  const result = await retryAdminPublication(store, pub.id);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
});

test("scheduleApproved rejects unapproved Pinterest content", async () => {
  process.env.MARKETING_MOCK_MODE = "true";
  const store = new MemoryMarketingStore();
  const content = samplePinterestContent({ status: "needs_review" });
  await store.createContent(content);
  await assert.rejects(() => scheduleApproved(store, content.id), /Only approved content can be scheduled/);
});

test("live Pinterest preflight fails when credentials are missing", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  delete process.env.PINTEREST_CLIENT_ID;
  const store = new MemoryMarketingStore();
  await store.createAsset({
    id: "asset-1",
    name: "pin",
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "2:3",
    imageWidth: 1000,
    imageHeight: 1500,
    mimeType: "image/png",
    tags: [],
    url: "https://cdn.example.test/pin.png",
    altText: "x",
    isDemo: false,
  });
  const content = samplePinterestContent({ status: "approved", assetIds: ["asset-1"] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /PINTEREST_BOARD_ID/);
  }
});

test("Pinterest aspect ratio constants match documented vertical band", () => {
  assert.ok(PINTEREST_MIN_IMAGE_WIDTH >= 600);
  assert.ok(PINTEREST_ASPECT_RATIO_MIN < PINTEREST_ASPECT_RATIO_MAX);
  const ratio1000x1500 = 1000 / 1500;
  assert.ok(ratio1000x1500 >= PINTEREST_ASPECT_RATIO_MIN);
  assert.ok(ratio1000x1500 <= PINTEREST_ASPECT_RATIO_MAX);
});
