import assert from "node:assert/strict";
import { test } from "node:test";
import { isEditableManualUploadAsset } from "./content-metadata-client";
import type { MarketingAsset } from "./types";

function asset(overrides: Partial<MarketingAsset>): MarketingAsset {
  return {
    id: "asset-1",
    name: "Test",
    type: "upload",
    source: "manual_upload",
    url: "/x.png",
    approved: false,
    bookId: null,
    characterId: null,
    campaignId: null,
    usageRestrictions: null,
    aspectRatio: null,
    altText: null,
    imageWidth: null,
    imageHeight: null,
    tags: [],
    isDemo: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("manual upload image assets are editable", () => {
  assert.equal(isEditableManualUploadAsset(asset({ type: "upload" })), true);
});

test("catalog and demo assets are not editable", () => {
  assert.equal(isEditableManualUploadAsset(asset({ source: "catalog" })), false);
  assert.equal(isEditableManualUploadAsset(asset({ isDemo: true })), false);
});

test("non-manual sources are not editable", () => {
  assert.equal(isEditableManualUploadAsset(asset({ source: "generated" })), false);
});
