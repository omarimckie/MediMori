import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  defaultRecycleScheduleDatetimeLocal,
  isoToMarketingDatetimeLocal,
  marketingDatetimeLocalToIso,
  nextFutureRecycleScheduleIso,
} from "./marketing-scheduling";

const TZ = "America/New_York";

test("past original scheduled datetime defaults to next future occurrence preserving time-of-day", () => {
  const previous = marketingDatetimeLocalToIso("2026-09-22T12:00", TZ);
  const now = new Date("2026-09-30T18:00:00.000Z"); // Sep 30, 2026 2:00 PM EDT
  const iso = nextFutureRecycleScheduleIso(previous, now, TZ);
  assert.equal(iso, marketingDatetimeLocalToIso("2026-10-01T12:00", TZ));
  assert.equal(defaultRecycleScheduleDatetimeLocal(previous, now, TZ), "2026-10-01T12:00");
});

test("same-day future scheduled time remains valid", () => {
  const previous = marketingDatetimeLocalToIso("2026-09-22T12:00", TZ);
  const now = new Date("2026-09-30T14:00:00.000Z"); // Sep 30, 2026 10:00 AM EDT
  const iso = nextFutureRecycleScheduleIso(previous, now, TZ);
  assert.equal(iso, marketingDatetimeLocalToIso("2026-09-30T12:00", TZ));
});

test("same-day past scheduled time advances to the next day", () => {
  const previous = marketingDatetimeLocalToIso("2026-09-22T12:00", TZ);
  const now = new Date("2026-09-30T17:30:00.000Z"); // Sep 30, 2026 1:30 PM EDT
  const iso = nextFutureRecycleScheduleIso(previous, now, TZ);
  assert.equal(iso, marketingDatetimeLocalToIso("2026-10-01T12:00", TZ));
});

test("recycle default uses America/New_York wall time across DST boundaries", () => {
  const previous = marketingDatetimeLocalToIso("2026-03-01T09:30", TZ);
  const now = new Date("2026-03-08T12:00:00.000Z"); // morning of spring-forward Sunday in UTC
  const local = defaultRecycleScheduleDatetimeLocal(previous, now, TZ);
  const iso = marketingDatetimeLocalToIso(local, TZ);
  assert.ok(new Date(iso).getTime() > now.getTime());
  assert.equal(local.slice(11), "09:30");
});

test("result is strictly after the injected current instant", () => {
  const previous = marketingDatetimeLocalToIso("2026-06-15T10:30", TZ);
  const now = new Date(marketingDatetimeLocalToIso("2026-06-15T10:30", TZ));
  const iso = nextFutureRecycleScheduleIso(previous, now, TZ);
  assert.ok(new Date(iso).getTime() > now.getTime());
});

test("ScheduleContentModal uses recycle default helper only in recycle mode", () => {
  const source = readFileSync(
    new URL("../../components/admin/marketing/ScheduleContentModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /defaultRecycleScheduleDatetimeLocal/);
  assert.match(source, /Schedule recycled post/);
  assert.match(source, /Choose when this post should be published again/);
  assert.match(source, /isRecycle\s*\?[\s\S]*defaultRecycleScheduleDatetimeLocal/);
});

test("first-time schedule modal still initializes from initialScheduledFor without recycle helper", () => {
  const source = readFileSync(
    new URL("../../components/admin/marketing/ScheduleContentModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /isRecycle\s*\?\s*defaultRecycleScheduleDatetimeLocal[\s\S]*:\s*isoToMarketingDatetimeLocal\(initialScheduledFor/,
  );
});

test("isoToMarketingDatetimeLocal unchanged for explicit first-time schedule values", () => {
  const iso = "2026-05-01T16:00:00.000Z";
  assert.equal(isoToMarketingDatetimeLocal(iso, TZ), "2026-05-01T12:00");
});
