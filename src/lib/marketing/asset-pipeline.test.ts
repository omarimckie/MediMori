import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { afterEach, mock, test } from "node:test";
import { syncCatalogAssetTruth } from "./assets";
import {
  clearAssetTruthCacheForTests,
  getAssetImageTruth,
  probePublicAssetUrl,
  truthFromDimensions,
  widthHeightRatio,
} from "./asset-truth";
import { selectAssetWithTruths } from "./asset-selection";
import { classifyMetaHttpError } from "./meta";
import {
  INSTAGRAM_FEED_ASPECT_RATIO_MAX,
  INSTAGRAM_FEED_ASPECT_RATIO_MIN,
  isAssetSuitableForPlatform,
} from "./platform-suitability";
import { publishDueButtonLabel, formatPublicationStatusLabel, isMockPublicationProvider } from "./publication-display";
import { runPublishPreflight } from "./publish-preflight";
import { MemoryMarketingStore } from "./memory-store";
import type { MarketingAsset, MarketingContent, MarketingPublication } from "./types";

const originalMockMode = process.env.MARKETING_MOCK_MODE;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  clearAssetTruthCacheForTests();
  mock.restoreAll();
  process.env.MARKETING_MOCK_MODE = originalMockMode;
  process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

function asset(overrides: Partial<MarketingAsset> & Pick<MarketingAsset, "id" | "type" | "url">): MarketingAsset {
  return {
    name: overrides.name ?? overrides.id,
    source: "catalog",
    bookId: overrides.bookId ?? "book-one",
    characterId: overrides.characterId ?? null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: overrides.aspectRatio ?? null,
    imageWidth: overrides.imageWidth ?? null,
    imageHeight: overrides.imageHeight ?? null,
    mimeType: overrides.mimeType ?? null,
    tags: [],
    altText: null,
    isDemo: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function truthsFor(assets: MarketingAsset[]) {
  const map = new Map<string, ReturnType<typeof truthFromDimensions> | null>();
  for (const a of assets) {
    if (a.imageWidth && a.imageHeight) {
      map.set(a.id, truthFromDimensions(a.imageWidth, a.imageHeight, a.mimeType ?? "image/png"));
    } else {
      map.set(a.id, null);
    }
  }
  return map;
}

test("width/height ratio and Instagram feed bounds", () => {
  const amara = truthFromDimensions(522, 961, "image/png");
  assert.equal(widthHeightRatio(522, 961), amara.aspectRatio);
  assert.equal(
    isAssetSuitableForPlatform(amara, "instagram", "post"),
    false,
  );
  assert.ok(amara.aspectRatio < INSTAGRAM_FEED_ASPECT_RATIO_MIN);

  const cover = truthFromDimensions(1009, 1024, "image/png");
  assert.equal(isAssetSuitableForPlatform(cover, "instagram", "post"), true);
  assert.ok(cover.aspectRatio >= INSTAGRAM_FEED_ASPECT_RATIO_MIN);
  assert.ok(cover.aspectRatio <= INSTAGRAM_FEED_ASPECT_RATIO_MAX);

  const aj = truthFromDimensions(800, 1870, "image/png");
  assert.equal(isAssetSuitableForPlatform(aj, "instagram", "post"), false);

  const wordSearch = truthFromDimensions(842, 1080, "image/jpeg");
  assert.equal(isAssetSuitableForPlatform(wordSearch, "instagram", "post"), false);

  const asthmaInside3 = truthFromDimensions(1024, 512, "image/png");
  assert.equal(isAssetSuitableForPlatform(asthmaInside3, "instagram", "post"), false);
});

test("probes known catalog files from public/", async () => {
  const amara = await probePublicAssetUrl("/amara-waving.png");
  assert.ok(amara);
  assert.equal(amara.width, 522);
  assert.equal(amara.height, 961);

  const sickleCover = await probePublicAssetUrl("/covers/sickle-cell.png");
  assert.ok(sickleCover);
  assert.equal(sickleCover.width, 1009);
  assert.equal(sickleCover.height, 1024);
});

test("selectAsset prefers cover over character for Instagram when character is incompatible", () => {
  const character = asset({
    id: "char",
    type: "character",
    url: "/amara-waving.png",
    characterId: "amara",
    imageWidth: 522,
    imageHeight: 961,
  });
  const cover = asset({
    id: "cover",
    type: "cover",
    url: "/covers/sickle-cell.png",
    imageWidth: 1009,
    imageHeight: 1024,
  });
  const truths = truthsFor([character, cover]);
  const chosen = selectAssetWithTruths([character, cover], truths, {
    bookId: "book-one",
    characterId: "amara",
    platform: "instagram",
    format: "post",
    category: "brand_story",
  });
  assert.equal(chosen.asset?.id, "cover");
  assert.equal(chosen.needsNewAsset, false);
});

test("selectAsset uses character for email when social rules do not apply", () => {
  const character = asset({
    id: "char",
    type: "character",
    url: "/amara-waving.png",
    characterId: "amara",
    imageWidth: 522,
    imageHeight: 961,
  });
  const cover = asset({
    id: "cover",
    type: "cover",
    url: "/covers/sickle-cell.png",
    imageWidth: 1009,
    imageHeight: 1024,
  });
  const truths = truthsFor([character, cover]);
  const chosen = selectAssetWithTruths([character, cover], truths, {
    bookId: "book-one",
    characterId: "amara",
    platform: "email",
    format: "email",
    category: "educational",
  });
  assert.equal(chosen.asset?.id, "char");
});

test("selectAsset fallback marks needsNewAsset when no suitable social image exists", () => {
  const character = asset({
    id: "char",
    type: "character",
    url: "/amara-waving.png",
    characterId: "amara",
    imageWidth: 522,
    imageHeight: 961,
  });
  const truths = truthsFor([character]);
  const chosen = selectAssetWithTruths([character], truths, {
    bookId: "book-one",
    characterId: "amara",
    platform: "instagram",
    format: "post",
    category: "educational",
  });
  assert.equal(chosen.asset, null);
  assert.equal(chosen.needsNewAsset, true);
});

function sampleContent(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: "c1",
    campaignId: "camp",
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Hello",
    body: "Warm copy",
    cta: "Read",
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "abc",
    originalBody: "Warm copy",
    bookId: "book-one",
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("publish preflight rejects Amara asset for Instagram", async () => {
  const store = new MemoryMarketingStore();
  const bad = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "character",
      url: "/amara-waving.png",
      imageWidth: 522,
      imageHeight: 961,
    }),
  );
  const content = sampleContent({ assetIds: [bad.id] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "invalid_aspect_ratio");
  }
});

test("publish preflight accepts Sickle Cell cover for Instagram", async () => {
  const store = new MemoryMarketingStore();
  const good = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "cover",
      url: "/covers/sickle-cell.png",
      imageWidth: 1009,
      imageHeight: 1024,
    }),
  );
  const content = sampleContent({ assetIds: [good.id] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, true);
});

test("publish preflight does not call fetch", async () => {
  const store = new MemoryMarketingStore();
  const good = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "cover",
      url: "/covers/sickle-cell.png",
      imageWidth: 1009,
      imageHeight: 1024,
    }),
  );
  const content = sampleContent({ assetIds: [good.id] });
  await store.createContent(content);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("{}");
  }) as typeof fetch;
  try {
    await runPublishPreflight(store, content);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Meta aspect-ratio error maps to meta_invalid_image_aspect_ratio", () => {
  const classified = classifyMetaHttpError(400, {
    error: {
      message:
        "The submitted image with aspect ratio () cannot be published. Please submit an image with a valid aspect ratio.",
      code: 100,
    },
  }, []);
  assert.equal(classified.errorCode, "meta_invalid_image_aspect_ratio");
  assert.match(classified.error, /meta_invalid_image_aspect_ratio/);
});

test("Meta auth errors stay classified as meta_auth_expired", () => {
  const classified = classifyMetaHttpError(400, { error: { message: "bad token", code: 190 } }, []);
  assert.equal(classified.errorCode, "meta_auth_expired");
});

test("getAssetImageTruth uses persisted dimensions without reading public files", async () => {
  const readFile = mock.method(fs, "readFile", async () => {
    throw new Error("filesystem should not be used");
  });
  const truth = await getAssetImageTruth(
    asset({
      id: "persisted",
      type: "cover",
      url: "/covers/sickle-cell.png",
      imageWidth: 1009,
      imageHeight: 1024,
      mimeType: "image/png",
    }),
  );
  assert.equal(truth?.width, 1009);
  assert.equal(truth?.height, 1024);
  assert.equal(readFile.mock.calls.length, 0);
});

test("syncCatalogAssetTruth backfills catalog rows from manifest when files are unavailable", async () => {
  mock.method(fs, "readFile", async () => {
    throw new Error("no public filesystem");
  });
  const store = new MemoryMarketingStore();
  const row = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "cover",
      source: "catalog",
      url: "/covers/sickle-cell.png",
      imageWidth: null,
      imageHeight: null,
    }),
  );
  await syncCatalogAssetTruth(store);
  const updated = await store.getAsset(row.id);
  assert.equal(updated?.imageWidth, 1009);
  assert.equal(updated?.imageHeight, 1024);
  assert.equal(updated?.aspectRatio, "1009:1024");
});

test("preflight uses persisted truth only without filesystem access", async () => {
  mock.method(fs, "readFile", async () => {
    throw new Error("no public filesystem");
  });
  const store = new MemoryMarketingStore();
  const good = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "cover",
      url: "/covers/sickle-cell.png",
      imageWidth: 1009,
      imageHeight: 1024,
    }),
  );
  const content = sampleContent({ assetIds: [good.id] });
  await store.createContent(content);
  assert.equal((await runPublishPreflight(store, content)).ok, true);
});

test("preflight rejects Amara using persisted dimensions without filesystem", async () => {
  mock.method(fs, "readFile", async () => {
    throw new Error("no public filesystem");
  });
  const store = new MemoryMarketingStore();
  const bad = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "character",
      url: "/amara-waving.png",
      imageWidth: 522,
      imageHeight: 961,
    }),
  );
  const content = sampleContent({ assetIds: [bad.id] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, false);
});

test("live mode requires public HTTPS image URL when image is required", async () => {
  process.env.MARKETING_MOCK_MODE = "false";
  delete process.env.NEXT_PUBLIC_SITE_URL;
  const store = new MemoryMarketingStore();
  const good = await store.createAsset(
    asset({
      id: crypto.randomUUID(),
      type: "cover",
      url: "/covers/sickle-cell.png",
      imageWidth: 1009,
      imageHeight: 1024,
    }),
  );
  const content = sampleContent({ assetIds: [good.id] });
  await store.createContent(content);
  const result = await runPublishPreflight(store, content);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "invalid_asset");
  }
});

test("email content passes preflight without an image", async () => {
  const store = new MemoryMarketingStore();
  const content = sampleContent({
    platform: "email",
    format: "email",
    assetIds: [],
  });
  await store.createContent(content);
  assert.equal((await runPublishPreflight(store, content)).ok, true);
});

test("getAssetImageTruth falls back to manifest then filesystem when persisted truth is missing", async () => {
  mock.method(fs, "readFile", async () => {
    throw new Error("no public filesystem");
  });
  const fromManifest = await getAssetImageTruth(
    asset({
      id: "manifest",
      type: "cover",
      url: "/covers/sickle-cell.png",
      imageWidth: null,
      imageHeight: null,
    }),
  );
  assert.equal(fromManifest?.width, 1009);
});

test("mock publication labels and publish button wording", () => {
  assert.equal(isMockPublicationProvider("mock:mock_social"), true);
  assert.equal(isMockPublicationProvider("instagram"), false);
  const pub: MarketingPublication = {
    id: "p1",
    contentId: "c1",
    campaignId: null,
    platform: "google",
    provider: "mock:mock_social",
    status: "published",
    idempotencyKey: "k",
    externalId: "mock_pub:1",
    url: "https://mock.local/google/c1",
    attemptCount: 1,
    lastError: null,
    scheduledFor: null,
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert.equal(formatPublicationStatusLabel(pub), "mock published");
  assert.match(publishDueButtonLabel(true, false), /mock/i);
  assert.match(publishDueButtonLabel(false, false), /live Meta/i);
  assert.ok(!publishDueButtonLabel(false, false).toLowerCase().includes("mock-safe"));
});
