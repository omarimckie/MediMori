import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentBodyExcerpt,
  formatContentWeekLabel,
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

test("no-week empty state copy is documented in AddToWeekModal", () => {
  const message =
    "No weekly plans are available yet. Create a campaign and generate a week first.";
  assert.match(message, /weekly plans are available/i);
});
