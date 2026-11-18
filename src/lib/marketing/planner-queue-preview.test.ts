import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveReviewCardImageSrc } from "./content-queue-review";
import { plannerQueueListRequestUrl } from "./planner-queue-preview";

test("planner queue list defaults to preview enrichment", () => {
  assert.equal(
    plannerQueueListRequestUrl(),
    "/api/admin/marketing/planner/queue?enrich=preview",
  );
});

test("planner queue list can omit enrich for backward compatibility", () => {
  assert.equal(
    plannerQueueListRequestUrl({ enrich: "none" }),
    "/api/admin/marketing/planner/queue",
  );
});

test("planner queue preview uses authenticated proxy in production-shaped mode", () => {
  const adminPreview = "/api/admin/marketing/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/image";
  const resolved = resolveReviewCardImageSrc(adminPreview, false);
  assert.deepEqual(resolved, { kind: "proxy", src: adminPreview });
  assert.equal(resolveReviewCardImageSrc("https://evil.example/x", false), null);
});

test("planner queue route supports optional enrich=preview", () => {
  const source = readFileSync(
    new URL("../../app/api/admin/marketing/planner/queue/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildContentListPreviewById/);
  assert.match(source, /buildWeeklyItemReview/);
  assert.match(source, /enrich === "preview"/);
  assert.match(source, /previewReadonlyImages: isMarketingPreviewReadonly\(\)/);
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /POST/);
});