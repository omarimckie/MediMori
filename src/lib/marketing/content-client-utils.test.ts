import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentBodyExcerpt,
  formatContentWeekLabel,
  formatWeekPlanSelectorLabel,
  pickOperationalWeeklyPlanId,
} from "./content-client-utils";

test("contentBodyExcerpt truncates long body", () => {
  const long = "a".repeat(300);
  const excerpt = contentBodyExcerpt(long, 50);
  assert.equal(excerpt.length, 51);
  assert.match(excerpt, /…$/);
});

test("formatContentWeekLabel unassigned", () => {
  const result = formatContentWeekLabel(null, []);
  assert.equal(result.label, "Unassigned");
});

test("formatContentWeekLabel assigned plan", () => {
  const result = formatContentWeekLabel("p1", [{ id: "p1", weekStart: "2026-04-07" }]);
  assert.equal(result.label, "Week of 2026-04-07");
});

test("no-week empty state copy references New Week", () => {
  const message =
    "No weekly plans are available yet. Create an empty week from Your Week, or generate a campaign package.";
  assert.match(message, /Your Week/i);
});

test("pickOperationalWeeklyPlanId and week labels", () => {
  const plans = [
    { id: "a", weekStart: "2026-09-14" },
    { id: "b", weekStart: "2026-10-05" },
  ];
  assert.equal(pickOperationalWeeklyPlanId(plans, "2026-10-04"), "b");
  assert.match(formatWeekPlanSelectorLabel("2026-10-05", "2026-10-04"), /Upcoming/);
});
