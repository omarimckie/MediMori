import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentCanEnqueueToPlanner,
  contentShowsInPlanner,
  formatAddToPlannerSuccessMessage,
  parseAddToPlannerResponse,
} from "./content-planner-client";

test("contentCanEnqueueToPlanner allows approved not queued", () => {
  assert.equal(contentCanEnqueueToPlanner({ status: "approved" }), true);
  assert.equal(contentCanEnqueueToPlanner({ status: "needs_review" }), false);
  assert.equal(contentCanEnqueueToPlanner({ status: "approved", plannerQueued: true }), false);
});

test("contentShowsInPlanner reflects plannerQueued", () => {
  assert.equal(contentShowsInPlanner({ plannerQueued: true }), true);
  assert.equal(contentShowsInPlanner({}), false);
});

test("formatAddToPlannerSuccessMessage covers queued and alreadyQueued", () => {
  assert.match(formatAddToPlannerSuccessMessage(["a"], []), /Added to the planning queue/);
  assert.match(formatAddToPlannerSuccessMessage([], ["b"]), /Already in the planning queue/);
  assert.match(formatAddToPlannerSuccessMessage(["a", "b"], ["c"]), /already in the queue/i);
});

test("parseAddToPlannerResponse requires ok true", () => {
  assert.deepEqual(parseAddToPlannerResponse({ ok: true, queued: ["x"], alreadyQueued: [] }), {
    ok: true,
    queued: ["x"],
    alreadyQueued: [],
  });
  assert.deepEqual(
    parseAddToPlannerResponse({
      ok: true,
      queued: [{ id: "a", platform: "instagram" }],
      alreadyQueued: [{ id: "b" }],
    }),
    { ok: true, queued: ["a"], alreadyQueued: ["b"] },
  );
  assert.equal(parseAddToPlannerResponse({ ok: false }), null);
  assert.equal(parseAddToPlannerResponse(null), null);
});
