import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const calendar = readFileSync(new URL("./CalendarClient.tsx", import.meta.url), "utf8");
const thumb = readFileSync(new URL("./PlanningQueuePreviewThumb.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("./PlanningQueuePreviewModal.tsx", import.meta.url), "utf8");

test("calendar planning queue loads preview enrichment and thumb UI", () => {
  assert.match(calendar, /plannerQueueListRequestUrl/);
  assert.match(calendar, /PlanningQueuePreviewThumb/);
  assert.match(calendar, /PlanningQueuePreviewModal/);
  assert.match(calendar, /previewByContentId/);
  assert.match(calendar, /reviewByContentId/);
  assert.match(calendar, /Remove from queue/);
  assert.match(calendar, /loadPlanningQueue/);
});

test("planning queue thumb reuses safe review image resolution", () => {
  assert.match(thumb, /resolveReviewCardImageSrc/);
  assert.match(thumb, /ReviewPreviewImage/);
  assert.match(thumb, /reviewCardPreviewUnavailableMessage/);
  assert.doesNotMatch(thumb, /vercel-storage.*token/i);
});

test("planning queue expand modal shows platform and dimensions when present", () => {
  assert.match(modal, /channelLabel/);
  assert.match(modal, /dimensionsLabel/);
  assert.match(modal, /ReviewPreviewImage/);
});