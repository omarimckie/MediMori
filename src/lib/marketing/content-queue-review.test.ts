import assert from "node:assert/strict";
import { test } from "node:test";
import { approveContent } from "./approval";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { buildContentListPreviewById } from "./content-list-preview";
import {
  contentQueueRejectConfirmMessage,
  contentQueueShowsApproveReject,
  explicitPublicMarketingBlobReviewUrl,
  isSafeAdminContentPreviewUrl,
  resolveReviewCardImageSrc,
} from "./content-queue-review";
import { isMarketingAssetPublicImageEligible } from "./marketing-asset-public-image";
import { MemoryMarketingStore } from "./memory-store";

const BLOB_URL =
  "https://store.public.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png";

const RESTART_FIXTURES = [
  {
    id: "3ed23d6d-cf53-4a25-b0e8-2c56a8bc177b",
    platform: "facebook" as const,
    body: "Amara loves asking questions.\n\nRead Children Diseases: Sickle Cell on twilight-feather.com\n\n#childrensbooks",
  },
  {
    id: "6f24c7da-8054-46a5-8d25-93a431ce508d",
    platform: "instagram" as const,
    body: "Meet Amara—a curious girl.\n\nRead Children Diseases: Sickle Cell on twilight-feather.com\n\n#SickleCellAwareness",
  },
  {
    id: "d4840f95-383d-43b6-9e92-f506ad83c299",
    platform: "facebook" as const,
    body: "Say hello to Amara.\n\nWould you like to meet Amara with your child?\n\nRead Children Diseases: Sickle Cell on twilight-feather.com",
  },
  {
    id: "fb86b42b-00fd-42a3-a74f-62e8a50fa954",
    platform: "instagram" as const,
    body: "Meet Amara! She’s curious.\n\nRead Children Diseases: Sickle Cell on twilight-feather.com\n\n#childrensbooks #sicklecell",
  },
];

test("isSafeAdminContentPreviewUrl accepts only admin asset image paths", () => {
  const id = "2dde9aa2-b14d-4278-90c5-73f559da0e1b";
  assert.equal(isSafeAdminContentPreviewUrl(`/api/admin/marketing/assets/${id}/image`), true);
  assert.equal(isSafeAdminContentPreviewUrl(BLOB_URL), false);
  assert.equal(
    isSafeAdminContentPreviewUrl(
      "https://twilight-feather.com/api/marketing/assets/" + id + "/image",
    ),
    false,
  );
  assert.equal(isSafeAdminContentPreviewUrl("/api/marketing/assets/" + id + "/image"), false);
  assert.equal(isSafeAdminContentPreviewUrl(null), false);
});

test("explicit public Blob review URLs accept only the stored public image shape", () => {
  const accepted = explicitPublicMarketingBlobReviewUrl(BLOB_URL);
  assert.equal(accepted, BLOB_URL);
  assert.equal(isSafeAdminContentPreviewUrl(BLOB_URL), false);
  assert.equal(isSafeAdminContentPreviewUrl(BLOB_URL, { allowExplicitPublicBlob: true }), true);
  assert.deepEqual(resolveReviewCardImageSrc(BLOB_URL, false), null);
  assert.deepEqual(resolveReviewCardImageSrc(BLOB_URL, true), {
    kind: "public-blob",
    src: BLOB_URL,
  });

  const rejected = [
    "http://store.public.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
    "https://store.private.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
    "https://store.public.blob.vercel-storage.com/marketing/private/cccccccccccccccccccccccccccccccc.png",
    "https://store.public.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png?token=1",
    "https://user:secret@store.public.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
    "https://store.public.blob.vercel-storage.com/marketing/public/%2e%2e/private/cccccccccccccccccccccccccccccccc.png",
    "https://evil.public.blob.vercel-storage.com.example.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
    "https://public.blob.vercel-storage.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
    "https://example.com/marketing/public/cccccccccccccccccccccccccccccccc.png",
    "javascript:alert(1)",
    null,
  ];
  for (const url of rejected) {
    assert.equal(explicitPublicMarketingBlobReviewUrl(url), null, String(url));
    assert.equal(
      isSafeAdminContentPreviewUrl(url, { allowExplicitPublicBlob: true }),
      false,
      String(url),
    );
  }

  const mixedCase =
    "https://Q7Bbz4IQuVq0GO24.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
  assert.equal(
    explicitPublicMarketingBlobReviewUrl(mixedCase),
    "https://q7bbz4iquvq0go24.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  );
});

test("contentQueueShowsApproveReject only for needs_review", () => {
  assert.equal(contentQueueShowsApproveReject("needs_review"), true);
  assert.equal(contentQueueShowsApproveReject("approved"), false);
  assert.equal(contentQueueShowsApproveReject("scheduled"), false);
  assert.equal(contentQueueShowsApproveReject("published"), false);
  assert.equal(contentQueueShowsApproveReject("rejected"), false);
});

test("reject confirm message mentions no schedule or publish", () => {
  const message = contentQueueRejectConfirmMessage("Meet Amara", "instagram");
  assert.match(message, /Reject Meet Amara \(instagram\)/);
  assert.match(message, /not be scheduled or published/i);
});

test("needs_review restart fixtures enrich to admin preview URLs and keep full caption bodies", async () => {
  const store = new MemoryMarketingStore();
  for (const fixture of RESTART_FIXTURES) {
    const assetId = crypto.randomUUID();
    await store.createAsset({
      id: assetId,
      name: `${fixture.platform}.png`,
      type: "upload",
      source: SMART_UPLOAD_SOURCE,
      bookId: "book-one",
      characterId: null,
      campaignId: null,
      approved: true,
      usageRestrictions: null,
      aspectRatio: "1:1",
      imageWidth: 1080,
      imageHeight: 1080,
      mimeType: "image/png",
      tags: ["smart_upload"],
      url: BLOB_URL,
      altText: "alt",
      isDemo: true,
    });
    await store.createContent({
      id: fixture.id,
      campaignId: null,
      weeklyPlanId: null,
      platform: fixture.platform,
      format: "post",
      category: "educational",
      audience: "parents",
      status: "needs_review",
      title: fixture.body.slice(0, 40),
      body: fixture.body,
      cta: null,
      seoTitle: null,
      seoDescription: null,
      scheduledFor: null,
      timezone: "America/New_York",
      assetIds: [assetId],
      needsNewAsset: false,
      warnings: [],
      safetyFlags: [],
      trackingToken: `tok-${fixture.id.slice(0, 8)}`,
      originalBody: null,
      bookId: "book-one",
      metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: `fk-${fixture.id}` },
      isDemo: true,
    });
    const asset = await store.getAsset(assetId);
    assert.ok(asset);
    assert.equal(await isMarketingAssetPublicImageEligible(store, asset), false);
  }

  const rows = await store.listContent();
  const preview = await buildContentListPreviewById(store, rows);
  for (const fixture of RESTART_FIXTURES) {
    const content = rows.find((row) => row.id === fixture.id);
    assert.ok(content);
    assert.equal(content!.status, "needs_review");
    assert.equal(content!.platform, fixture.platform);
    assert.equal(content!.body, fixture.body);
    assert.match(content!.body, /\n/);
    const url = preview[fixture.id]?.previewUrl ?? null;
    assert.equal(preview[fixture.id]?.showVisualPreview, true);
    assert.equal(isSafeAdminContentPreviewUrl(url), true);
    assert.equal(contentQueueShowsApproveReject(content!.status), true);
  }
});

test("approveContent does not schedule, publish, or create publication rows", async () => {
  const store = new MemoryMarketingStore();
  const assetId = crypto.randomUUID();
  const contentId = "3ed23d6d-cf53-4a25-b0e8-2c56a8bc177b";
  await store.createAsset({
    id: assetId,
    name: "fixture.png",
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: [],
    url: BLOB_URL,
    altText: "",
    isDemo: true,
  });
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "caption\n\n#line",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [assetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-approve",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  });

  const updated = await approveContent(store, contentId, "owner");
  assert.equal(updated?.status, "approved");
  assert.equal(updated?.scheduledFor, null);
  const publications = await store.listPublications();
  assert.equal(publications.length, 0);
  const content = await store.getContent(contentId);
  assert.equal(content?.status, "approved");
  assert.equal(content?.body, "caption\n\n#line");
});
