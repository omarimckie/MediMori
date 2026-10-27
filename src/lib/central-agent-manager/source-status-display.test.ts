import assert from "node:assert/strict";
import test from "node:test";
import { formatProgressPercent } from "./source-status-display";

test("formatProgressPercent never substitutes zero for unknown progress", () => {
  assert.match(formatProgressPercent(undefined), /Unknown/i);
  assert.match(formatProgressPercent({ milestone: null, checklistItem: null, progressPercent: null, lastMeaningfulStateChange: null }), /Unknown/i);
  assert.equal(
    formatProgressPercent({
      milestone: null,
      checklistItem: null,
      progressPercent: 0,
      lastMeaningfulStateChange: null,
    }),
    "0%",
  );
});
