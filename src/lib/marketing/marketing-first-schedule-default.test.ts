import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultFirstScheduleDatetimeLocal,
  isoToMarketingDatetimeLocal,
  marketingDatetimeLocalToIso,
} from "./marketing-scheduling";

const TZ = "America/New_York";

test("existing scheduledFor always wins for first-time default", () => {
  const iso = "2026-05-01T16:00:00.000Z";
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: iso,
    assignedWeekStart: "2026-10-05",
    now: new Date("2026-10-04T12:00:00.000Z"),
    timeZone: TZ,
  });
  assert.equal(local, isoToMarketingDatetimeLocal(iso, TZ));
});

test("future assigned week defaults to weekStart with current marketing-local time-of-day", () => {
  const now = new Date("2026-10-04T18:30:00.000Z"); // Oct 4, 2:30 PM EDT
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: null,
    assignedWeekStart: "2026-10-05",
    now,
    timeZone: TZ,
  });
  assert.equal(local, "2026-10-05T14:30");
});

test("current assigned week defaults to now in marketing timezone", () => {
  const now = new Date("2026-10-04T18:30:00.000Z");
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: null,
    assignedWeekStart: "2026-09-29",
    now,
    timeZone: TZ,
  });
  assert.equal(local, isoToMarketingDatetimeLocal(now.toISOString(), TZ));
});

test("unassigned content defaults to now", () => {
  const now = new Date("2026-10-04T18:30:00.000Z");
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: null,
    assignedWeekStart: null,
    now,
    timeZone: TZ,
  });
  assert.equal(local, isoToMarketingDatetimeLocal(now.toISOString(), TZ));
});

test("default never lands in the past", () => {
  const now = new Date("2026-10-05T20:00:00.000Z"); // evening on weekStart day
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: null,
    assignedWeekStart: "2026-10-05",
    now,
    timeZone: TZ,
  });
  const iso = marketingDatetimeLocalToIso(local, TZ);
  assert.ok(new Date(iso).getTime() >= now.getTime());
});

test("timezone boundary: marketing-local now preserved for current week", () => {
  const now = new Date("2026-01-15T19:00:00.000Z"); // 2 PM EST
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: null,
    assignedWeekStart: "2026-01-12",
    now,
    timeZone: TZ,
  });
  assert.equal(local, "2026-01-15T14:00");
});

test("generated campaign row with existing scheduledFor unchanged", () => {
  const campaignSlot = "2026-10-08T19:00:00.000Z";
  const local = defaultFirstScheduleDatetimeLocal({
    initialScheduledFor: campaignSlot,
    assignedWeekStart: "2026-10-05",
    now: new Date("2026-10-04T12:00:00.000Z"),
    timeZone: TZ,
  });
  assert.equal(local, isoToMarketingDatetimeLocal(campaignSlot, TZ));
});
