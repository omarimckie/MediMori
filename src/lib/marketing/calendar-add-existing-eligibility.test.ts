import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import {
  calendarAddExistingEligibility,
  contentMatchesAddExistingSearch,
} from "./calendar-add-existing-eligibility";

test("approved content maps to schedule mode", () => {
  const result = calendarAddExistingEligibility({
    status: "approved",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.mode, "schedule");
});

test("scheduled content without publish history maps to schedule mode", () => {
  const result = calendarAddExistingEligibility({
    status: "scheduled",
    platform: "facebook",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.mode, "schedule");
});

test("scheduled content with publish history maps to recycle mode", () => {
  const result = calendarAddExistingEligibility({
    status: "scheduled",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: true,
  });
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.mode, "recycle");
});

test("published recyclable content maps to recycle mode", () => {
  const result = calendarAddExistingEligibility({
    status: "published",
    platform: "pinterest",
    format: "pin",
    hasPublishedPublication: true,
  });
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.mode, "recycle");
});

test("needs_review cannot be scheduled from calendar", () => {
  const result = calendarAddExistingEligibility({
    status: "needs_review",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.equal(result.eligible, false);
});

test("rejected cannot be scheduled from calendar", () => {
  const result = calendarAddExistingEligibility({
    status: "rejected",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.equal(result.eligible, false);
});

test("failed content status cannot be scheduled from calendar", () => {
  const result = calendarAddExistingEligibility({
    status: "failed",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.equal(result.eligible, false);
});

test("published without publication history is ineligible for recycle", () => {
  const result = calendarAddExistingEligibility({
    status: "published",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.equal(result.eligible, false);
});

test("content search matches title body and platform", () => {
  assert.equal(
    contentMatchesAddExistingSearch(
      { title: "Amara Tips", body: "x", platform: "instagram" },
      "amara",
    ),
    true,
  );
  assert.equal(
    contentMatchesAddExistingSearch(
      { title: null, body: "Word search fun", platform: "website" },
      "word",
    ),
    true,
  );
  assert.equal(
    contentMatchesAddExistingSearch(
      { title: "Post", body: "Body", platform: "pinterest" },
      "pinterest",
    ),
    true,
  );
});

test("calendar client components do not import server-only recycle module", () => {
  const root = process.cwd();
  const files = [
    "src/components/admin/marketing/CalendarClient.tsx",
    "src/components/admin/marketing/AddExistingPostPickerModal.tsx",
  ];
  for (const rel of files) {
    const source = readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(source, /@\/lib\/marketing\/recycle["']/);
    assert.doesNotMatch(source, /from ["']\.\/recycle["']/);
    assert.doesNotMatch(source, /asset-truth/);
  }
});
