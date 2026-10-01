import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDetailShowsRecycle,
  calendarEventShowsRecycleBadge,
  calendarEventStatusLabel,
  isContentRecyclablePlatform,
} from "./calendar-publication-eligibility";

test("published instagram exposes recycle in detail modal", () => {
  assert.equal(
    calendarDetailShowsRecycle({ eventKind: "published", canRecycle: true }),
    true,
  );
  assert.equal(isContentRecyclablePlatform({ platform: "instagram", format: "post" }), true);
  assert.equal(isContentRecyclablePlatform({ platform: "facebook", format: "post" }), true);
  assert.equal(isContentRecyclablePlatform({ platform: "pinterest", format: "pin" }), true);
});

test("published email does not expose recycle", () => {
  assert.equal(
    isContentRecyclablePlatform({ platform: "email", format: "email" }),
    false,
  );
  assert.equal(
    calendarDetailShowsRecycle({ eventKind: "published", canRecycle: false }),
    false,
  );
});

test("scheduled event displays scheduled state label", () => {
  assert.equal(calendarEventStatusLabel({ eventKind: "scheduled", isRecycle: false }), "Scheduled");
});

test("recycle scheduled event displays recycle state", () => {
  assert.equal(
    calendarEventStatusLabel({ eventKind: "scheduled", isRecycle: true }),
    "Scheduled · Recycle",
  );
  assert.equal(
    calendarEventShowsRecycleBadge({
      eventKind: "scheduled",
      isRecycle: true,
      canRecycle: false,
    }),
    true,
  );
});
