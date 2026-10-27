import assert from "node:assert/strict";
import test from "node:test";
import { approvalPlanDigest, canonicalApprovalPlan, taskPlanFingerprint } from "./plan-digest";
import { createSupervisorTask } from "./task";
import type { SupervisorTask } from "./types";

const now = "2026-10-21T20:00:00.000Z";

function task(operations: readonly string[] = ["merge_main", "production_deploy"]): SupervisorTask {
  return createSupervisorTask({
    id: "task-1",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "Prepare the requested work.",
    requestedOperations: operations,
    idempotencyKey: "idem-task",
    planVersion: 3,
    now,
  });
}

test("canonical approval digests are stable and scope-sensitive", () => {
  const original = task();
  const reordered = {
    ...original,
    requestedOperations: [...original.requestedOperations].reverse(),
    allowedCapabilityScope: [...original.allowedCapabilityScope].reverse(),
  };
  const input = { task: original, operation: "merge_main", environment: "local" };
  const canonical = canonicalApprovalPlan(input);
  assert.equal(canonical.sourceRevision, null);
  assert.equal(canonical.targetRevision, null);
  assert.deepEqual(canonical.requestedOperations, ["merge_main", "production_deploy"]);
  assert.equal(approvalPlanDigest(input), approvalPlanDigest({ ...input, task: reordered }));
  assert.equal(taskPlanFingerprint(original), taskPlanFingerprint(reordered));
  assert.notEqual(approvalPlanDigest(input), taskPlanFingerprint(original));

  const sameVersion = {
    ...original,
    requestedOperations: ["merge_main"],
    allowedCapabilityScope: ["merge_main"],
  };
  assert.equal(sameVersion.planVersion, original.planVersion);
  assert.notEqual(
    approvalPlanDigest({ task: sameVersion, operation: "merge_main", environment: "local" }),
    approvalPlanDigest(input),
  );
  assert.notEqual(
    approvalPlanDigest({ ...input, operation: "production_deploy" }),
    approvalPlanDigest(input),
  );
  assert.notEqual(
    approvalPlanDigest({ ...input, environment: "staging" }),
    approvalPlanDigest(input),
  );
  assert.notEqual(
    approvalPlanDigest({
      ...input,
      task: { ...original, budget: { ...original.budget, modelCalls: original.budget.modelCalls + 1 } },
    }),
    approvalPlanDigest(input),
  );
  assert.notEqual(
    approvalPlanDigest({ ...input, task: { ...original, planVersion: original.planVersion + 1 } }),
    approvalPlanDigest(input),
  );
  assert.throws(
    () => approvalPlanDigest({
      ...input,
      task: { ...original, budget: { ...original.budget, costUsd: 1.5 } },
    }),
    /not canonical/,
  );
});
