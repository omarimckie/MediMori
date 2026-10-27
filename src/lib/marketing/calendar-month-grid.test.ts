import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarMonthCells } from "./calendar-month-grid";

test("month grid has complete weeks and includes current month days", () => {
  const cells = buildCalendarMonthCells(2026, 9, "America/New_York");
  assert.equal(cells.length % 7, 0);
  assert.ok(cells.length >= 28);
  const inMonth = cells.filter((cell) => cell.inCurrentMonth);
  assert.equal(inMonth.length, 30);
  assert.equal(inMonth[0]?.dayKey, "2026-09-01");
  assert.equal(inMonth[inMonth.length - 1]?.dayKey, "2026-09-30");
});
