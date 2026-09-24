import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { contentMayBePublished, publishPublication, scheduleApproved } from "./approval";
import {
  getMetaFacebookCredentials,
  getMetaInstagramCredentials,
  getMetaGraphVersion,
} from "./config";
import { MemoryMarketingStore } from "./memory-store";
import {
  INSTAGRAM_CONTAINER_POLL_MAX_REQUESTS,
  classifyMetaHttpError,
  composePublishCaption,
  redactSecrets,
} from "./meta";
import {
  FacebookPagePublisher,
  InstagramPublisher,
  getSocialPublisher,
} from "./publishers";
import { seedMarketing } from "./seed";
import type { MarketingContent, MarketingPublication } from "./types";

const originalEnv = {
  mock: process.env.MARKETING_MOCK_MODE,
  igUser: process.env.META_INSTAGRAM_USER_ID,
  igToken: process.env.META_INSTAGRAM_ACCESS_TOKEN,
  fbPage: process.env.META_FACEBOOK_PAGE_ID,
  fbToken: process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN,
  graph: process.env.META_GRAPH_API_VERSION,
};

afterEach(() => {
  process.env.MARKETING_MOCK_MODE = originalEnv.mock;
  process.env.META_INSTAGRAM_USER_ID = originalEnv.igUser;
  process.env.META_INSTAGRAM_ACCESS_TOKEN = originalEnv.igToken;
  process.env.META_FACEBOOK_PAGE_ID = originalEnv.fbPage;
  process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN = originalEnv.fbToken;
  process.env.META_GRAPH_API_VERSION = originalEnv.graph;
});

const SECRET_TOKEN = "TEST_META_TOKEN_DO_NOT_LEAK";

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "c1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "Hello",
    body: "Warm bedtime copy",
    cta: "Read the book",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "abc",
    originalBody: "Warm bedtime copy",
    bookId: "book-one",
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function samplePublication(
  overrides: Partial<MarketingPublication> = {},
): MarketingPublication {
  return {
    id: "pub",
    contentId: "c1",
    campaignId: "camp",
    platform: "instagram",
    provider: "instagram",
    status: "processing",
    idempotencyKey: "pub:c1:instagram",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const IG_CREDENTIALS = {
  userId: "ig-user",
  accessToken: SECRET_TOKEN,
  graphVersion: "v22.0",
};

type GraphCall = { method: string; url: string; body?: URLSearchParams };

function createInstagramGraphFetch(options: {
  containerId: string;
  statusSequence: string[];
  publishId?: string;
  onMedia?: () => Response | Promise<Response>;
}): { fetchImpl: typeof fetch; calls: GraphCall[] } {
  const calls: GraphCall[] = [];
  let statusIndex = 0;
  const publishId = options.publishId ?? "ig_media_99";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      init?.body != null ? new URLSearchParams(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (method === "POST" && url.endsWith("/media")) {
      if (options.onMedia) return options.onMedia();
      return jsonResponse(200, { id: options.containerId });
    }
    if (
      method === "GET" &&
      url.includes(`/${options.containerId}`) &&
      url.includes("fields=status_code")
    ) {
      const status =
        options.statusSequence[
          Math.min(statusIndex, options.statusSequence.length - 1)
        ] ?? "IN_PROGRESS";
      if (statusIndex < options.statusSequence.length - 1) {
        statusIndex += 1;
      }
      return jsonResponse(200, { status_code: status });
    }
    if (method === "POST" && url.endsWith("/media_publish")) {
      return jsonResponse(200, { id: publishId });
    }
    return jsonResponse(404, { error: { message: "unknown" } });
  };
  return { fetchImpl, calls };
}

const instantSleep = async () => {};

test("Meta credential helpers require both id and token", () => {
  assert.equal(getMetaGraphVersion({}), "v22.0");
  assert.equal(getMetaInstagramCredentials({}), null);
  assert.equal(
    getMetaInstagramCredentials({
      META_INSTAGRAM_USER_ID: "28572065502429844",
    }),
    null,
  );
  const ig = getMetaInstagramCredentials({
    META_INSTAGRAM_USER_ID: "ig-user",
    META_INSTAGRAM_ACCESS_TOKEN: SECRET_TOKEN,
    META_GRAPH_API_VERSION: "v21.0",
  });
  assert.equal(ig?.userId, "ig-user");
  assert.equal(ig?.graphVersion, "v21.0");
  assert.equal(getMetaFacebookCredentials({ META_FACEBOOK_PAGE_ID: "page" }), null);
});

test("live publisher selection stays on the existing mock switch", () => {
  process.env.MARKETING_MOCK_MODE = "true";
  assert.equal(getSocialPublisher("instagram").id, "mock_social");
  process.env.MARKETING_MOCK_MODE = "false";
  assert.equal(getSocialPublisher("instagram").id, "instagram");
  assert.equal(getSocialPublisher("facebook").id, "facebook_page");
  process.env.PINTEREST_CLIENT_ID = "client";
  process.env.PINTEREST_CLIENT_SECRET = "secret";
  process.env.PINTEREST_REFRESH_TOKEN = "pinr_test";
  process.env.PINTEREST_BOARD_ID = "board";
  assert.equal(getSocialPublisher("pinterest").id, "pinterest");
});

test("Instagram publisher polls IN_PROGRESS then FINISHED before media_publish", async () => {
  const { fetchImpl, calls } = createInstagramGraphFetch({
    containerId: "container_1",
    statusSequence: ["IN_PROGRESS", "FINISHED"],
  });

  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    sleep: instantSleep,
    credentials: IG_CREDENTIALS,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });

  assert.equal(result.ok, true);
  assert.equal(result.externalId, "ig_media_99");
  assert.deepEqual(
    calls.map((call) => call.method + " " + (call.url.includes("/media_publish") ? "publish" : call.url.includes("/media") && call.method === "POST" ? "create" : "status")),
    ["POST create", "GET status", "GET status", "POST publish"],
  );
  const publishCall = calls.find((call) => call.url.endsWith("/media_publish"));
  assert.equal(publishCall?.body?.get("creation_id"), "container_1");
  const publishIndex = calls.findIndex((call) => call.url.endsWith("/media_publish"));
  const lastStatusIndex = calls.findLastIndex(
    (call) => call.method === "GET" && call.url.includes("fields=status_code"),
  );
  assert.ok(lastStatusIndex >= 0 && publishIndex > lastStatusIndex);
  assert.equal(
    calls[0]?.url,
    "https://graph.instagram.com/v22.0/ig-user/media",
  );
  assert.equal(
    calls[0]?.body?.get("image_url"),
    "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  );
  assert.equal(
    calls[0]?.body?.get("caption"),
    composePublishCaption("Warm bedtime copy", "Read the book"),
  );
  assert.ok(!calls[0]?.url.includes(SECRET_TOKEN));
  assert.ok(!publishCall?.url.includes(SECRET_TOKEN));
});

test("Instagram publisher publishes when container is already FINISHED", async () => {
  const { fetchImpl, calls } = createInstagramGraphFetch({
    containerId: "container_ready",
    statusSequence: ["FINISHED"],
  });
  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    sleep: instantSleep,
    credentials: IG_CREDENTIALS,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, true);
  assert.equal(calls.filter((c) => c.method === "GET").length, 1);
  assert.equal(calls.at(-1)?.url.endsWith("/media_publish"), true);
});

test("Instagram publisher times out when container stays IN_PROGRESS", async () => {
  const { fetchImpl, calls } = createInstagramGraphFetch({
    containerId: "container_slow",
    statusSequence: Array(INSTAGRAM_CONTAINER_POLL_MAX_REQUESTS).fill("IN_PROGRESS"),
  });
  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    sleep: instantSleep,
    credentials: IG_CREDENTIALS,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_container_status_timeout");
  assert.equal(result.externalId, undefined);
  assert.equal(calls.some((call) => call.url.endsWith("/media_publish")), false);
  assert.equal(
    calls.filter((call) => call.method === "GET" && call.url.includes("status_code")).length,
    INSTAGRAM_CONTAINER_POLL_MAX_REQUESTS,
  );
});

test("Instagram publisher fails on container ERROR without media_publish", async () => {
  const { fetchImpl, calls } = createInstagramGraphFetch({
    containerId: "container_err",
    statusSequence: ["ERROR"],
  });
  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    sleep: instantSleep,
    credentials: IG_CREDENTIALS,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_container_error");
  assert.equal(calls.some((call) => call.url.endsWith("/media_publish")), false);
});

test("Instagram publisher fails on container EXPIRED without media_publish", async () => {
  const { fetchImpl, calls } = createInstagramGraphFetch({
    containerId: "container_exp",
    statusSequence: ["EXPIRED"],
  });
  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    sleep: instantSleep,
    credentials: IG_CREDENTIALS,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_container_expired");
  assert.equal(calls.some((call) => call.url.endsWith("/media_publish")), false);
});

test("Instagram publisher fails on unknown container status without media_publish", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/media")) {
      return jsonResponse(200, { id: "container_weird" });
    }
    if (method === "GET" && url.includes("container_weird")) {
      return jsonResponse(200, { status_code: "PENDING_REVIEW" });
    }
    if (method === "POST" && url.endsWith("/media_publish")) {
      return jsonResponse(200, { id: "should-not-publish" });
    }
    return jsonResponse(404, {});
  };
  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    sleep: instantSleep,
    credentials: IG_CREDENTIALS,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_container_status_unknown");
});

test("Meta media-not-ready HTTP message maps to meta_media_not_ready", () => {
  const classified = classifyMetaHttpError(
    400,
    { error: { message: "The media is not ready for publishing. Please wait.", code: 9007 } },
    [],
  );
  assert.equal(classified.errorCode, "meta_media_not_ready");
  assert.match(classified.error, /meta_media_not_ready/);
});

test("Facebook publisher uses photos for images and feed for text", async () => {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, body });
    if (url.endsWith("/photos")) return jsonResponse(200, { id: "photo_1", post_id: "page_post_1" });
    if (url.endsWith("/feed")) return jsonResponse(200, { id: "page_post_text" });
    return jsonResponse(404, {});
  };
  const credentials = {
    pageId: "page-id",
    pageAccessToken: SECRET_TOKEN,
    graphVersion: "v22.0",
  };
  const photo = await new FacebookPagePublisher({ fetch: fetchImpl, credentials }).publish({
    content: sampleContent({ platform: "facebook" }),
    publication: samplePublication({ platform: "facebook", provider: "facebook_page" }),
    imageUrl: "https://twilight-feather.vercel.app/covers/asthma.png",
  });
  assert.equal(photo.ok, true);
  assert.equal(photo.externalId, "page_post_1");
  assert.equal(calls[0]?.url, "https://graph.facebook.com/v22.0/page-id/photos");
  assert.equal(calls[0]?.body.get("url"), "https://twilight-feather.vercel.app/covers/asthma.png");

  const text = await new FacebookPagePublisher({ fetch: fetchImpl, credentials }).publish({
    content: sampleContent({ platform: "facebook" }),
    publication: samplePublication({
      id: "pub-text",
      platform: "facebook",
      provider: "facebook_page",
      idempotencyKey: "pub:c1:facebook:text",
    }),
  });
  assert.equal(text.ok, true);
  assert.equal(text.externalId, "page_post_text");
  assert.equal(calls[1]?.url, "https://graph.facebook.com/v22.0/page-id/feed");
  assert.match(calls[1]?.body.get("message") ?? "", /Warm bedtime copy/);
});

test("missing Meta credentials fail without publishing", async () => {
  const ig = await new InstagramPublisher({ credentials: null, fetch: async () => {
    throw new Error("fetch should not run");
  } }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/instagram-api-test.png",
  });
  assert.equal(ig.ok, false);
  assert.equal(ig.errorCode, "meta_credentials_missing");

  const fb = await new FacebookPagePublisher({ credentials: null, fetch: async () => {
    throw new Error("fetch should not run");
  } }).publish({
    content: sampleContent({ platform: "facebook" }),
    publication: samplePublication({ platform: "facebook" }),
  });
  assert.equal(fb.ok, false);
  assert.equal(fb.errorCode, "meta_credentials_missing");
});

test("malformed Meta responses are not treated as published", async () => {
  const result = await new InstagramPublisher({
    credentials: {
      userId: "ig-user",
      accessToken: SECRET_TOKEN,
      graphVersion: "v22.0",
    },
    fetch: async () => jsonResponse(200, { unexpected: true }),
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_malformed_response");
  assert.equal(result.externalId, undefined);
});

test("successful Meta result parsing returns the platform id only", async () => {
  const { fetchImpl } = createInstagramGraphFetch({
    containerId: "container",
    statusSequence: ["FINISHED"],
    publishId: "17841400000000000",
  });
  const ig = await new InstagramPublisher({
    credentials: IG_CREDENTIALS,
    fetch: fetchImpl,
    sleep: instantSleep,
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(ig.externalId, "17841400000000000");
});

test("idempotent publish does not call Meta again", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse(200, { id: "should-not-use" });
  };
  const result = await new InstagramPublisher({
    fetch: fetchImpl,
    credentials: {
      userId: "ig-user",
      accessToken: SECRET_TOKEN,
      graphVersion: "v22.0",
    },
  }).publish({
    content: sampleContent(),
    publication: samplePublication({
      status: "published",
      externalId: "already_posted",
    }),
    imageUrl: "https://twilight-feather.vercel.app/covers/sickle-cell.png",
  });
  assert.equal(result.ok, true);
  assert.equal(result.externalId, "already_posted");
  assert.equal(calls, 0);
});

test("expired tokens are classified and secrets stay out of errors", async () => {
  const result = await new FacebookPagePublisher({
    credentials: {
      pageId: "page-id",
      pageAccessToken: SECRET_TOKEN,
      graphVersion: "v22.0",
    },
    fetch: async () =>
      jsonResponse(401, {
        error: {
          message: `Invalid OAuth access token ${SECRET_TOKEN}`,
          type: "OAuthException",
          code: 190,
        },
      }),
  }).publish({
    content: sampleContent({ platform: "facebook" }),
    publication: samplePublication({ platform: "facebook" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "meta_auth_expired");
  assert.ok(result.error);
  assert.ok(!result.error.includes(SECRET_TOKEN));
  assert.equal(redactSecrets(`token=${SECRET_TOKEN}`, [SECRET_TOKEN]).includes(SECRET_TOKEN), false);
});

test("Instagram refuses unpublished or local image URLs", async () => {
  const missing = await new InstagramPublisher({
    credentials: {
      userId: "ig-user",
      accessToken: SECRET_TOKEN,
      graphVersion: "v22.0",
    },
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorCode, "meta_image_missing");

  const local = await new InstagramPublisher({
    credentials: {
      userId: "ig-user",
      accessToken: SECRET_TOKEN,
      graphVersion: "v22.0",
    },
  }).publish({
    content: sampleContent(),
    publication: samplePublication(),
    imageUrl: "http://localhost:3000/instagram-api-test.png",
  });
  assert.equal(local.ok, false);
  assert.equal(local.errorCode, "meta_image_inaccessible");
});

test("failed Meta publish does not mark the store publication as published", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  process.env.META_INSTAGRAM_USER_ID = "ig-user";
  process.env.META_INSTAGRAM_ACCESS_TOKEN = SECRET_TOKEN;
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
  const publication = await scheduleApproved(store, item.id);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse(400, { error: { message: `bad token ${SECRET_TOKEN}`, code: 190 } })) as typeof fetch;
  try {
    const failed = await publishPublication(store, publication);
    assert.equal(failed.status, "failed");
    assert.notEqual(failed.status, "published");
    assert.equal(failed.externalId, null);
    assert.ok(failed.lastError);
    assert.ok(!failed.lastError.includes(SECRET_TOKEN));
    assert.match(failed.lastError, /meta_auth_expired/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unapproved content cannot be published", async () => {
  const store = new MemoryMarketingStore();
  await seedMarketing(store);
  const item = (await store.listContent({ status: "needs_review" }))[0];
  assert.ok(item);
  assert.equal(contentMayBePublished(item.status), false);
  const publication = await store.createPublication({
    id: crypto.randomUUID(),
    contentId: item.id,
    campaignId: item.campaignId,
    platform: item.platform,
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: `blocked:${item.id}`,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date().toISOString(),
    publishedAt: null,
  });
  const result = await publishPublication(store, publication);
  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /not approved/);
  const content = await store.getContent(item.id);
  assert.equal(content?.status, "needs_review");
});
