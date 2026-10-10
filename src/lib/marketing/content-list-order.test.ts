import assert from "node:assert/strict";
import { test } from "node:test";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { sortMarketingContentForAdminList } from "./content-list-order";
import type { MarketingContent } from "./types";

function row(
  overrides: Partial<MarketingContent> & Pick<MarketingContent, "id" | "platform" | "createdAt">,
): MarketingContent {
  return {
    campaignId: null,
    weeklyPlanId: null,
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: null,
    body: "body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "t",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

test("newest smart upload group appears first with instagram, facebook, pinterest adjacent", () => {
  const older = row({
    id: "old-ig",
    platform: "instagram",
    createdAt: "2026-10-01T10:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "old-key" },
  });
  const olderFb = row({
    id: "old-fb",
    platform: "facebook",
    createdAt: "2026-10-01T10:00:01.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "old-key" },
  });
  const newerPin = row({
    id: "new-pin",
    platform: "pinterest",
    createdAt: "2026-10-09T10:00:02.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "new-key" },
  });
  const newerIg = row({
    id: "new-ig",
    platform: "instagram",
    createdAt: "2026-10-09T10:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "new-key" },
  });
  const newerFb = row({
    id: "new-fb",
    platform: "facebook",
    createdAt: "2026-10-09T10:00:01.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "new-key" },
  });
  const sorted = sortMarketingContentForAdminList([
    older,
    newerPin,
    olderFb,
    newerFb,
    newerIg,
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["new-ig", "new-fb", "new-pin", "old-ig", "old-fb"],
  );
});

test("non-smart-upload items sort newest first between groups", () => {
  const manualOld = row({
    id: "manual-old",
    platform: "website",
    format: "free_resource",
    createdAt: "2026-10-01T12:00:00.000Z",
  });
  const manualNew = row({
    id: "manual-new",
    platform: "email",
    format: "email",
    createdAt: "2026-10-09T12:00:00.000Z",
  });
  const sorted = sortMarketingContentForAdminList([manualOld, manualNew]);
  assert.deepEqual(sorted.map((item) => item.id), ["manual-new", "manual-old"]);
});

test("mixed smart upload and manual content uses group newest timestamp", () => {
  const uploadIg = row({
    id: "su-ig",
    platform: "instagram",
    createdAt: "2026-10-09T09:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "su-1" },
  });
  const uploadFb = row({
    id: "su-fb",
    platform: "facebook",
    createdAt: "2026-10-09T09:00:01.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "su-1" },
  });
  const manual = row({
    id: "manual",
    platform: "instagram",
    createdAt: "2026-10-09T10:00:00.000Z",
  });
  const sorted = sortMarketingContentForAdminList([uploadFb, manual, uploadIg]);
  assert.deepEqual(sorted.map((item) => item.id), ["manual", "su-ig", "su-fb"]);
});

test("equal group timestamps remain stable via platform rank and id", () => {
  const pin = row({
    id: "b-pin",
    platform: "pinterest",
    format: "pin",
    createdAt: "2026-10-09T10:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "same" },
  });
  const ig = row({
    id: "a-ig",
    platform: "instagram",
    createdAt: "2026-10-09T10:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "same" },
  });
  const fb = row({
    id: "c-fb",
    platform: "facebook",
    createdAt: "2026-10-09T10:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, smartUploadFinalizeKey: "same" },
  });
  const sorted = sortMarketingContentForAdminList([pin, fb, ig]);
  assert.deepEqual(sorted.map((item) => item.id), ["a-ig", "c-fb", "b-pin"]);
});

test("missing finalize key falls back to batch id grouping", () => {
  const ig = row({
    id: "ig",
    platform: "instagram",
    createdAt: "2026-10-09T10:00:00.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, batchId: "batch-1" },
  });
  const fb = row({
    id: "fb",
    platform: "facebook",
    createdAt: "2026-10-09T10:00:01.000Z",
    metadata: { source: SMART_UPLOAD_SOURCE, batchId: "batch-1" },
  });
  const sorted = sortMarketingContentForAdminList([fb, ig]);
  assert.deepEqual(sorted.map((item) => item.id), ["ig", "fb"]);
});
