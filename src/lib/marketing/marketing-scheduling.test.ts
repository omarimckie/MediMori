import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDayKeyInMarketingTimezone,
  isPublicationDue,
  isoToMarketingDatetimeLocal,
  marketingDatetimeLocalToIso,
  parseMarketingScheduleInput,
} from "./marketing-scheduling";

const TZ = "America/New_York";

/** What misinterpreting datetime-local as UTC would produce. */
function naiveUtcFromDatetimeLocal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  assert.ok(match);
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ),
  ).toISOString();
}

test("marketingDatetimeLocalToIso converts EDT wall time to UTC (summer)", () => {
  const local = "2026-06-15T10:30";
  const iso = marketingDatetimeLocalToIso(local, TZ);
  assert.equal(iso, "2026-06-15T14:30:00.000Z");
  assert.notEqual(iso, naiveUtcFromDatetimeLocal(local));
});

test("marketingDatetimeLocalToIso converts EST wall time to UTC (winter)", () => {
  const local = "2026-01-15T09:00";
  const iso = marketingDatetimeLocalToIso(local, TZ);
  assert.equal(iso, "2026-01-15T14:00:00.000Z");
  assert.notEqual(iso, naiveUtcFromDatetimeLocal(local));
});

test("iso round-trips through marketing datetime-local formatting (EST)", () => {
  const iso = "2026-03-10T17:00:00.000Z";
  const local = isoToMarketingDatetimeLocal(iso, TZ);
  assert.equal(local, "2026-03-10T13:00");
  assert.equal(marketingDatetimeLocalToIso(local, TZ), iso);
});

test("DST spring forward: wall times before and after the gap convert correctly", () => {
  const beforeGap = marketingDatetimeLocalToIso("2026-03-08T01:30", TZ);
  assert.equal(beforeGap, "2026-03-08T06:30:00.000Z");

  const afterGap = marketingDatetimeLocalToIso("2026-03-08T03:30", TZ);
  assert.equal(afterGap, "2026-03-08T07:30:00.000Z");
});

test("DST spring forward: nonexistent 02:xx wall time does not silently become UTC midnight", () => {
  const gapAttempt = "2026-03-08T02:30";
  let iso: string;
  try {
    iso = marketingDatetimeLocalToIso(gapAttempt, TZ);
  } catch (error) {
    assert.match(String(error), /invalid_schedule_time/);
    return;
  }
  assert.notEqual(iso, naiveUtcFromDatetimeLocal(gapAttempt));
  assert.equal(isoToMarketingDatetimeLocal(iso, TZ), gapAttempt);
});

test("DST fall back: 01:30 wall time resolves to a single consistent instant", () => {
  const local = "2026-11-01T01:30";
  const iso = marketingDatetimeLocalToIso(local, TZ);
  assert.notEqual(iso, naiveUtcFromDatetimeLocal(local));
  assert.equal(marketingDatetimeLocalToIso(local, TZ), iso);
  assert.equal(isoToMarketingDatetimeLocal(iso, TZ), local);
});

test("parseMarketingScheduleInput rejects invalid values", () => {
  assert.throws(
    () => parseMarketingScheduleInput("", TZ),
    /invalid_schedule_time/,
  );
  assert.throws(
    () => parseMarketingScheduleInput("not-a-date", TZ),
    /invalid_schedule_time/,
  );
});

test("isPublicationDue treats missing scheduledFor as immediately due", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");
  assert.equal(isPublicationDue(null, now), true);
  assert.equal(isPublicationDue("2026-01-01T11:00:00.000Z", now), true);
  assert.equal(isPublicationDue("2026-01-01T13:00:00.000Z", now), false);
});

test("calendarDayKeyInMarketingTimezone uses marketing timezone not UTC slice", () => {
  const key = calendarDayKeyInMarketingTimezone(
    "2026-03-10T03:30:00.000Z",
    TZ,
  );
  assert.equal(key, "2026-03-09");
});

test("parseMarketingScheduleInput uses marketing timezone for datetime-local strings", () => {
  const iso = parseMarketingScheduleInput("2026-01-20T08:15", TZ);
  assert.equal(iso, "2026-01-20T13:15:00.000Z");
  assert.notEqual(iso, naiveUtcFromDatetimeLocal("2026-01-20T08:15"));
});
