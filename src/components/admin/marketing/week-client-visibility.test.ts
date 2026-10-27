import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  NEW_WEEK_BUTTON_LABEL,
  shouldRenderNewWeekControl,
  shouldRenderWeekPlanSelector,
} from "./week-client-visibility";

test("week selector is conditional on multiple plans", () => {
  assert.equal(shouldRenderWeekPlanSelector(0), false);
  assert.equal(shouldRenderWeekPlanSelector(1), false);
  assert.equal(shouldRenderWeekPlanSelector(2), true);
});

test("New Week control is always enabled regardless of plan count or timing", () => {
  assert.equal(shouldRenderNewWeekControl(0), true);
  assert.equal(shouldRenderNewWeekControl(1), true);
  assert.equal(shouldRenderNewWeekControl(5), true);
});

test("WeekClient wires New Week in the main action row and opens modal", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/admin/marketing/WeekClient.tsx"),
    "utf8",
  );
  assert.match(src, /NEW_WEEK_BUTTON_LABEL/);
  assert.match(src, /openNewWeekModal/);
  assert.match(src, /NewWeekModal/);
  const actionRowIndex = src.indexOf('className="mt-5 flex flex-wrap gap-2"');
  assert.ok(actionRowIndex >= 0, "expected main action row");
  const actionRowSlice = src.slice(actionRowIndex, actionRowIndex + 1200);
  assert.match(actionRowSlice, /openNewWeekModal/);
  assert.match(actionRowSlice, /NEW_WEEK_BUTTON_LABEL/);
});

test("WeekClient does not hide New Week behind plans.length > 1", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/admin/marketing/WeekClient.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /plans\.length\s*>\s*1[\s\S]{0,400}openNewWeekModal/,
    "New Week should not be gated on multiple plans",
  );
});
