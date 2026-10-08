import assert from "node:assert/strict";
import { test } from "node:test";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { MemoryMarketingStore } from "./memory-store";
import {
  parseSmartUploadFinalizeRows,
  SmartUploadFinalizeKeyConflictError,
} from "./smart-upload-idempotency";
import type { MarketingContent } from "./types";

function smartUploadRow(
  partial: Partial<MarketingContent> & { id: string; platform: "instagram" | "facebook" },
  finalizeKey: string,
  assetId: string,
): MarketingContent {
  return {
    id: partial.id,
    campaignId: null,
    weeklyPlanId: null,
    platform: partial.platform,
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [assetId],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: `tok-${partial.id}`,
    originalBody: null,
    bookId: null,
    metadata: {
      source: "smart_upload",
      smartUploadFinalizeKey: finalizeKey,
    },
    isDemo: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("parseSmartUploadFinalizeRows allows one IG and one FB per key", () => {
  const key = "key-1";
  const assetId = "asset-1";
  const lookup = parseSmartUploadFinalizeRows(
    [
      smartUploadRow({ id: "ig", platform: "instagram" }, key, assetId),
      smartUploadRow({ id: "fb", platform: "facebook" }, key, assetId),
    ],
    key,
  );
  assert.equal(lookup.status, "complete");
});

test("parseSmartUploadFinalizeRows detects partial IG-only", () => {
  const key = "key-partial";
  const lookup = parseSmartUploadFinalizeRows(
    [smartUploadRow({ id: "ig", platform: "instagram" }, key, "asset-a")],
    key,
  );
  assert.equal(lookup.status, "partial");
});

test("parseSmartUploadFinalizeRows allows FB-only row set as complete", () => {
  const key = "key-fb-only";
  const lookup = parseSmartUploadFinalizeRows(
    [
      smartUploadRow({ id: "fb", platform: "facebook" }, key, "asset-a"),
    ],
    key,
  );
  assert.equal(lookup.status, "complete");
});

test("memory store rejects duplicate instagram for same finalize key", async () => {
  const store = new MemoryMarketingStore();
  const key = "dup-ig";
  const base = smartUploadRow({ id: "ig1", platform: "instagram" }, key, "a1");
  await store.createContent(base);
  await assert.rejects(
    () => store.createContent({ ...base, id: "ig2", trackingToken: "tok-2" }),
    (error: Error) => error instanceof SmartUploadFinalizeKeyConflictError,
  );
});

test("memory store rejects duplicate facebook for same finalize key", async () => {
  const store = new MemoryMarketingStore();
  const key = "dup-fb";
  const assetId = "asset-shared";
  await store.createContent(smartUploadRow({ id: "ig", platform: "instagram" }, key, assetId));
  await store.createContent(smartUploadRow({ id: "fb1", platform: "facebook" }, key, assetId));
  await assert.rejects(
    () =>
      store.createContent(
        smartUploadRow({ id: "fb2", platform: "facebook" }, key, assetId),
      ),
    (error: Error) => error instanceof SmartUploadFinalizeKeyConflictError,
  );
});

test("findSmartUploadContentByFinalizeKey is not limited to recent content window", async () => {
  const store = new MemoryMarketingStore();
  const key = "old-key";
  const assetId = "asset-old";
  for (let i = 0; i < 520; i += 1) {
    await store.createContent({
      id: crypto.randomUUID(),
      campaignId: null,
      weeklyPlanId: null,
      platform: "email",
      format: "post",
      category: "educational",
      audience: "parents",
      status: "draft",
      title: `filler-${i}`,
      body: "x",
      cta: null,
      seoTitle: null,
      seoDescription: null,
      scheduledFor: null,
      timezone: "America/New_York",
      assetIds: [],
      needsNewAsset: false,
      warnings: [],
      safetyFlags: [],
      trackingToken: `fill-${i}`,
      originalBody: null,
      bookId: null,
      metadata: {},
      isDemo: true,
    });
  }
  await store.createContent(smartUploadRow({ id: "ig-old", platform: "instagram" }, key, assetId));
  await store.createContent(smartUploadRow({ id: "fb-old", platform: "facebook" }, key, assetId));
  const lookup = await store.findSmartUploadContentByFinalizeKey(key);
  assert.equal(lookup.status, "complete");
  if (lookup.status === "complete") {
    assert.equal(lookup.instagram!.metadata?.source, SMART_UPLOAD_SOURCE);
  }
});
