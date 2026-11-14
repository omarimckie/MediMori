import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./CalendarClient.tsx", import.meta.url), "utf8");

test("calendar planning queue exposes remove-from-planner control", () => {
  assert.match(source, /remove-from-planner/);
  assert.match(source, /Remove from queue/);
  assert.match(source, /loadPlanningQueue/);
});