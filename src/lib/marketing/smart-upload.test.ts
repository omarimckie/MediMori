import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import sharp from "sharp";
import { marketingAuthError } from "./auth-guard";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { assertImageUpload, MAX_MARKETING_IMAGE_BYTES } from "./file-validation";
import { MemoryMarketingStore } from "./memory-store";
import {
  assertSmartUploadUrlAuthorized,
  parseSmartUploadUrlBody,
} from "./smart-presigned-put";
import { allocateSmartUploadPathname, finalizeSmartUploadFromBuffer, validateSmartUploadImageBytes } from "./smart-upload";
import { issueSmartUploadIntent } from "./smart-upload-intent";

const PREVIEW_PATH = `marketing/public/${"a".repeat(32)}.png`;
const OTHER_PREVIEW_PATH = `marketing/public/${"b".repeat(32)}.png`;

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "smart-upload-test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

async function pngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 140, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

async function planContext(store: MemoryMarketingStore) {
  const planId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  await store.createCampaign({
    id: campaignId,
    name: "Smart upload campaign",
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
    bookIds: [],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: true,
  });
  await store.createWeeklyPlan({
    id: planId,
    campaignId,
    weekStart: "2026-03-02",
    status: "ready",
    summary: {
      itemCount: 0,
      newAssetCount: 0,
      warningCount: 0,
      objective: "Test",
      audience: "parents",
      quotas: {
        instagram: 1,
        facebook: 1,
        pinterest: 0,
        email: 0,
        website: 0,
        google: 0,
      },
    },
    rationale: {},
    isDemo: true,
  });
  return { planId, campaignId };
}

async function finalizeValid(
  store: MemoryMarketingStore,
  options?: {
    weeklyPlanId?: string | null;
    campaignId?: string | null;
    width?: number;
    height?: number;
    finalizeKey?: string;
    batchId?: string;
    caption?: string;
  },
) {
  const buffer = await pngBuffer(options?.width ?? 1080, options?.height ?? 1080);
  return finalizeSmartUploadFromBuffer(store, {
    caption: options?.caption ?? "Shared smart upload caption",
    batchId: options?.batchId ?? "batch-1",
    finalizeKey: options?.finalizeKey ?? crypto.randomUUID(),
    weeklyPlanId: options?.weeklyPlanId ?? null,
    campaignId: options?.campaignId ?? null,
    actor: "owner",
    imageBuffer: buffer,
    imageFilename: "smart.png",
  });
}

test("one valid image creates exactly one asset and two content rows", async () => {
  const store = new MemoryMarketingStore();
  const result = await finalizeValid(store);
  assert.equal((await store.listAssets()).length, 1);
  assert.equal((await store.listContent()).length, 2);
  assert.equal(result.assetId, result.instagram!.assetIds[0]);
  assert.equal(result.facebook!.assetIds[0], result.assetId);
});

test("per-platform finalize persists distinct facebook and instagram bodies", async () => {
  const store = new MemoryMarketingStore();
  const buffer = await pngBuffer(1080, 1080);
  const result = await finalizeSmartUploadFromBuffer(store, {
    caption: "",
    platformCaptions: {
      facebook: "Facebook-only caption",
      instagram: "Instagram-only caption\n\n#TwilightFeather",
    },
    batchId: "batch-pp",
    finalizeKey: crypto.randomUUID(),
    weeklyPlanId: null,
    campaignId: null,
    actor: "owner",
    imageBuffer: buffer,
    imageFilename: "smart.png",
  });
  assert.equal(result.facebook!.body, "Facebook-only caption");
  assert.equal(result.instagram!.body, "Instagram-only caption\n\n#TwilightFeather");
  assert.doesNotMatch(result.facebook!.body, /TwilightFeather/);
});

test("instagram and facebook rows are needs_review with shared caption", async () => {
  const store = new MemoryMarketingStore();
  const caption = "Caption copied to both platforms.";
  const result = await finalizeValid(store, { caption });
  assert.equal(result.instagram!.platform, "instagram");
  assert.equal(result.facebook!.platform, "facebook");
  assert.equal(result.instagram!.format, "post");
  assert.equal(result.facebook!.format, "post");
  assert.equal(result.instagram!.status, "needs_review");
  assert.equal(result.facebook!.status, "needs_review");
  assert.equal(result.instagram!.body, caption);
  assert.equal(result.facebook!.body, caption);
});

test("optional weeklyPlanId and null weeklyPlanId", async () => {
  const store = new MemoryMarketingStore();
  const { planId } = await planContext(store);
  const withPlan = await finalizeValid(store, { weeklyPlanId: planId, finalizeKey: "k1" });
  assert.equal(withPlan.instagram!.weeklyPlanId, planId);

  const withoutPlan = await finalizeValid(store, { weeklyPlanId: null, finalizeKey: "k2" });
  assert.equal(withoutPlan.instagram!.weeklyPlanId, null);
});

test("optional campaign validates and attaches", async () => {
  const store = new MemoryMarketingStore();
  const { campaignId } = await planContext(store);
  const result = await finalizeValid(store, { campaignId, finalizeKey: "k-campaign" });
  assert.equal(result.instagram!.campaignId, campaignId);
});

test("unique tracking tokens and smart upload metadata", async () => {
  const store = new MemoryMarketingStore();
  const result = await finalizeValid(store, { batchId: "batch-xyz", finalizeKey: "fin-1" });
  assert.notEqual(result.instagram!.trackingToken, result.facebook!.trackingToken);
  assert.equal(result.instagram!.metadata?.source, SMART_UPLOAD_SOURCE);
  assert.equal(result.instagram!.metadata?.batchId, "batch-xyz");
  assert.equal(result.instagram!.metadata?.smartUploadFinalizeKey, "fin-1");
  assert.equal(result.instagram!.metadata?.originalAssetId, result.assetId);
});

test("no publication rows created", async () => {
  const store = new MemoryMarketingStore();
  await finalizeValid(store);
  assert.equal((await store.listPublications()).length, 0);
});

test("invalid instagram ratio blocks entire image", async () => {
  const store = new MemoryMarketingStore();
  const buffer = await pngBuffer(500, 1000);
  await assert.rejects(
    () =>
      finalizeSmartUploadFromBuffer(store, {
        caption: "Test",
        batchId: "b",
        finalizeKey: "f-ig",
        actor: "owner",
        imageBuffer: buffer,
        imageFilename: "tall.png",
      }),
    (error: Error & { validationIssues?: { platform?: string }[] }) => {
      assert.ok(error.validationIssues?.some((i) => i.platform === "instagram"));
      return true;
    },
  );
  assert.equal((await store.listContent()).length, 0);
  assert.equal((await store.listAssets()).length, 0);
});

test("invalid facebook ratio blocks both content rows", async () => {
  const store = new MemoryMarketingStore();
  const buffer = await pngBuffer(1920, 1000);
  const validation = await validateSmartUploadImageBytes(buffer);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.issues.some((i) => i.platform === "instagram"));
  }
  await assert.rejects(() =>
    finalizeSmartUploadFromBuffer(store, {
      caption: "Test",
      batchId: "b",
      finalizeKey: "f-fb",
      actor: "owner",
      imageBuffer: buffer,
      imageFilename: "wide.png",
    }),
  );
  assert.equal((await store.listContent()).length, 0);
});

test("server-side dimensions are authoritative on asset", async () => {
  const store = new MemoryMarketingStore();
  await finalizeValid(store, { width: 1200, height: 1200 });
  const asset = (await store.listAssets())[0];
  assert.equal(asset?.imageWidth, 1200);
  assert.equal(asset?.imageHeight, 1200);
  assert.equal(asset?.source, SMART_UPLOAD_SOURCE);
  assert.equal(asset?.approved, true);
});

test("oversized and invalid image bytes rejected", async () => {
  const huge = Buffer.alloc(MAX_MARKETING_IMAGE_BYTES + 1);
  assert.throws(() => assertImageUpload(huge), /exceeds/);
  const validation = await validateSmartUploadImageBytes(Buffer.from("not-an-image"));
  assert.equal(validation.ok, false);
});

test("idempotent finalize does not duplicate content", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "same-key";
  const first = await finalizeValid(store, { finalizeKey });
  const second = await finalizeValid(store, { finalizeKey });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.instagramContentId, first.instagramContentId);
  assert.equal((await store.listContent()).length, 2);
});

test("one invalid file does not prevent another from succeeding", async () => {
  const store = new MemoryMarketingStore();
  const bad = await pngBuffer(500, 1000);
  await assert.rejects(() =>
    finalizeSmartUploadFromBuffer(store, {
      caption: "Bad",
      batchId: "batch",
      finalizeKey: "bad",
      actor: "owner",
      imageBuffer: bad,
      imageFilename: "bad.png",
    }),
  );
  const good = await finalizeValid(store, { finalizeKey: "good" });
  assert.ok(good.instagramContentId);
  assert.equal((await store.listContent()).length, 2);
});

test("admin authorization guard", () => {
  assert.equal(marketingAuthError(false)?.status, 401);
  assert.equal(marketingAuthError(true), null);
});

test("arbitrary blob pathname rejected for upload URL", () => {
  const { uploadIntent } = issueSmartUploadIntent({
    username: "owner",
    pathname: PREVIEW_PATH,
  });
  assert.throws(() =>
    assertSmartUploadUrlAuthorized(uploadIntent, OTHER_PREVIEW_PATH, "owner"),
  );
  assert.throws(() => issueSmartUploadIntent({ username: "owner", pathname: "marketing/private/evil.pdf" }));
});

test("upload URL body parser requires fields", () => {
  assert.throws(() => parseSmartUploadUrlBody({}));
  const parsed = parseSmartUploadUrlBody({ uploadIntent: "x", pathname: PREVIEW_PATH });
  assert.equal(parsed.pathname, PREVIEW_PATH);
});

test("allocated pathname stays in marketing public namespace", () => {
  const pathname = allocateSmartUploadPathname("photo.PNG");
  assert.match(pathname, /^marketing\/public\/[a-f0-9]{32}\.png$/i);
});

test("concurrent finalize with same key creates one asset and two content rows", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "concurrent-key";
  const [a, b] = await Promise.all([
    finalizeValid(store, { finalizeKey }),
    finalizeValid(store, { finalizeKey }),
  ]);
  assert.equal((await store.listAssets()).length, 1);
  assert.equal((await store.listContent()).length, 2);
  assert.equal(a.instagramContentId, b.instagramContentId);
  assert.equal(a.facebookContentId, b.facebookContentId);
  assert.ok(a.idempotentReplay || b.idempotentReplay || a.assetId === b.assetId);
});

test("partial IG-only state completes facebook without second asset", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "partial-ig-key";
  const assetId = crypto.randomUUID();
  const caption = "Partial recovery caption";
  await store.createAsset({
    id: assetId,
    name: "seed.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: "Smart Upload original image (immutable).",
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: ["smart_upload"],
    url: "https://example.com/seed.png",
    altText: "seed",
    isDemo: false,
  });
  await store.createContent({
    id: crypto.randomUUID(),
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "IG",
    body: caption,
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [assetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "partialigtok",
    originalBody: null,
    bookId: null,
    metadata: {
      source: "smart_upload",
      smartUploadFinalizeKey: finalizeKey,
      batchId: "batch-partial",
      smartUploadDestinations: { facebook: true, instagram: true, pinterest: false },
    },
    isDemo: false,
  });

  const result = await finalizeValid(store, { finalizeKey, caption });
  assert.equal((await store.listAssets()).length, 1);
  assert.equal((await store.listContent()).length, 2);
  assert.equal(result.assetId, assetId);
  assert.equal(result.idempotentReplay, true);
});

test("partial facebook-only state completes instagram without second asset", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "fb-only-key";
  const assetId = crypto.randomUUID();
  await store.createAsset({
    id: assetId,
    name: "seed.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: "Smart Upload original image (immutable).",
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: ["smart_upload"],
    url: "https://example.com/seed.png",
    altText: "seed",
    isDemo: false,
  });
  await store.createContent({
    id: crypto.randomUUID(),
    campaignId: null,
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "FB",
    body: "orphan fb",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [assetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "fbtok",
    originalBody: null,
    bookId: null,
    metadata: {
      source: "smart_upload",
      smartUploadFinalizeKey: finalizeKey,
      smartUploadDestinations: { facebook: true, instagram: true, pinterest: false },
    },
    isDemo: false,
  });
  const result = await finalizeValid(store, { finalizeKey, caption: "Recovery caption" });
  assert.equal((await store.listContent()).length, 2);
  assert.ok(result.instagramContentId);
});

test("same finalize key with different image does not create a second pair", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "key-path-owner";
  const first = await finalizeValid(store, { finalizeKey, width: 1080, height: 1080 });
  const second = await finalizeValid(store, { finalizeKey, width: 1200, height: 1200 });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.instagramContentId, first.instagramContentId);
  assert.equal((await store.listAssets()).length, 1);
  assert.equal((await store.listContent()).length, 2);
});

test("different finalize keys with same image create separate pairs", async () => {
  const store = new MemoryMarketingStore();
  const buffer = await pngBuffer(1080, 1080);
  const first = await finalizeSmartUploadFromBuffer(store, {
    caption: "One",
    batchId: "b1",
    finalizeKey: "key-a",
    actor: "owner",
    imageBuffer: buffer,
    imageFilename: "a.png",
  });
  const second = await finalizeSmartUploadFromBuffer(store, {
    caption: "Two",
    batchId: "b2",
    finalizeKey: "key-b",
    actor: "owner",
    imageBuffer: buffer,
    imageFilename: "b.png",
  });
  assert.notEqual(first.assetId, second.assetId);
  assert.equal((await store.listAssets()).length, 2);
  assert.equal((await store.listContent()).length, 4);
});

test("concurrent finalize does not delete winner-owned instagram row", async () => {
  const store = new MemoryMarketingStore();
  const finalizeKey = "rollback-safe";
  await Promise.all([
    finalizeValid(store, { finalizeKey }),
    finalizeValid(store, { finalizeKey }),
  ]);
  const lookup = await store.findSmartUploadContentByFinalizeKey(finalizeKey);
  assert.equal(lookup.status, "complete");
  const instagramRows = (await store.listContent()).filter(
    (row) =>
      row.platform === "instagram" &&
      row.metadata?.smartUploadFinalizeKey === finalizeKey,
  );
  assert.equal(instagramRows.length, 1);
});
