import { test } from "node:test";
import assert from "node:assert/strict";
import { attemptPresentation } from "./attempt-presentation";

const run = (id: string, attemptNumber: number, disposition: string) => ({ id, attemptNumber, planVersion: 3, startedAt: "2026-10-05T00:00:00Z", finishedAt: null, disposition, modelCalls: 0, tokens: 0, costUsd: "0.000000" });

test("expired current attempt exposes fresh-preparation action and next attempt number", () => {
  const view = attemptPresentation({ status: "implementing", attempts: [run("old", 1, "expired")] });
  assert.equal(view.canPrepare, true);
  assert.equal(view.nextAttemptNumber, 2);
});

test("prepared request indicates fresh plan approval is still required", () => {
  const view = attemptPresentation({ status: "analyzing", attempts: [run("old", 1, "expired")], latestPreparation: { previousAttemptNumber: 1, toVersion: 5 } });
  assert.equal(view.canPrepare, false);
  assert.equal(view.nextAttemptNumber, 2);
  assert.equal(view.freshApprovalRequired, true);
});

test("a completed second attempt advances the displayed next-attempt number", () => {
  const view = attemptPresentation({ status: "blocked", attempts: [run("second", 2, "blocked"), run("first", 1, "expired")], latestPreparation: { previousAttemptNumber: 1, toVersion: 5 } });
  assert.equal(view.canPrepare, true);
  assert.equal(view.nextAttemptNumber, 3);
});

test("live or successful attempts never expose a retry action", () => {
  assert.equal(attemptPresentation({ status: "implementing", attempts: [run("active", 1, "active")] }).canPrepare, false);
  assert.equal(attemptPresentation({ status: "awaiting_merge", attempts: [run("done", 1, "succeeded")] }).canPrepare, false);
});
