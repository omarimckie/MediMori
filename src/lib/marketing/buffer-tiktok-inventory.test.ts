import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildTikTokPublicationInventory,
  sanitizePublicationLastError,
} from "./buffer/buffer-tiktok-inventory";
import type { MarketingPublication } from "./types";

function pub(overrides: Partial<MarketingPublication>): MarketingPublication {
  return {
    id: crypto.randomUUID(),
    contentId: crypto.randomUUID(),
    campaignId: null,
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "scheduled",
    idempotencyKey: "k",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: "2026-08-01T12:00:00.000Z",
    publishedAt: null,
    ambiguityState: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("inventory counts overdue legacy and ambiguous rows", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const rows = [
    pub({ status: "scheduled", scheduledFor: "2026-10-01T12:00:00.000Z" }),
    pub({ status: "scheduled", scheduledFor: "2025-01-01T12:00:00.000Z" }),
    pub({ status: "processing" }),
    pub({ status: "failed", lastError: "Bearer token expired: secret" }),
    pub({ status: "scheduled", ambiguityState: "ambiguous" }),
    pub({ provider: "legacy_tiktok", status: "failed" }),
  ];
  const inventory = buildTikTokPublicationInventory(rows, now, { limit: 10, offset: 0 });
  assert.equal(inventory.counts.scheduled, 1);
  assert.equal(inventory.counts.overdue, 1);
  assert.equal(inventory.counts.processing, 1);
  assert.equal(inventory.counts.failed, 2);
  assert.equal(inventory.counts.ambiguous, 1);
  assert.equal(inventory.counts.unexpectedProvider, 1);
  assert.equal(inventory.total, 6);
  const failed = inventory.items.find((item) => item.status === "failed" && item.provider === "buffer_tiktok");
  assert.equal(failed?.lastErrorSummary, "Publication error details withheld.");
});

test("inventory pagination is bounded", () => {
  const rows = Array.from({ length: 5 }, () => pub({}));
  const inventory = buildTikTokPublicationInventory(rows, new Date(), { limit: 2, offset: 1 });
  assert.equal(inventory.items.length, 2);
  assert.equal(inventory.total, 5);
});

test("sanitizePublicationLastError truncates long messages", () => {
  const long = "x".repeat(300);
  const sanitized = sanitizePublicationLastError(long);
  assert.ok(sanitized && sanitized.length <= 180);
});

test("inventory route requires marketing admin", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/marketing/buffer/tiktok/inventory/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /requireMarketingAdmin/);
  assert.doesNotMatch(route, /requireMarketingAdminMutation/);
});