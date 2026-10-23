import assert from "node:assert/strict";
import test from "node:test";
import { executionAuthorizationDisabled, safeTask } from "./admin-execution-authorization";

const attemptId = "4db0623b-0111-41dd-8422-d85576cff7bb";
const targetSha = "44c697f9d6b494f0bc8bdf6d0e44bc96fc6a7c05";
const sourceRevision = "fa844f9fffa4dd7e162a334b9e0ee6c74c953f8d";

function task(policy: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "79a4f5e2-0565-41c3-9503-5eb6678cf890",
    request: "Supervised README validation",
    status: "awaiting_execution",
    version: 7,
    risk: "low",
    created_by: "owner",
    plan: {
      summary: "README marker",
      files: ["README.md"],
      validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"],
      operations: [],
    },
    preparedAttempt: {
      attemptId,
      attemptNumber: 2,
      subjectGeneration: 1,
      planVersion: 7,
      risk: "low",
      targetRepository: "omarimckie/MediMori",
      targetBranch: "main",
      targetBaseSha: targetSha,
      implementationSourceRevision: sourceRevision,
      sourceSelectionPolicyVersion: policy,
    },
    ...overrides,
  };
}

function projectedPolicy(policy: unknown) {
  const prepared = safeTask(task(policy)).preparedAttempt as { sourceSelectionPolicyVersion?: number } | null;
  return prepared;
}

function authorizationDisabled(policy: unknown, overrides: Parameters<typeof executionAuthorizationDisabled>[0] = {
  busy: false,
  workerEnabled: true,
  taskVersion: 7,
  planTarget: { baseSha: targetSha },
}) {
  const prepared = projectedPolicy(policy);
  return executionAuthorizationDisabled({
    ...overrides,
    preparedAttempt: overrides.preparedAttempt === undefined ? prepared : overrides.preparedAttempt,
    taskVersion: overrides.taskVersion,
    planTarget: overrides.planTarget,
    workerEnabled: overrides.workerEnabled,
    busy: overrides.busy,
  });
}

test("safeTask projects source-selection policy version 2", () => {
  const prepared = projectedPolicy(2);
  assert.equal(prepared?.sourceSelectionPolicyVersion, 2);
  assert.equal(authorizationDisabled(2), false);
});

test("safeTask omits missing and invalid source-selection policy versions", () => {
  for (const policy of [undefined, null, "2", 2.5, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.0 + Number.EPSILON]) {
    const prepared = projectedPolicy(policy);
    assert.equal(prepared === null, false);
    assert.equal(Object.hasOwn(prepared ?? {}, "sourceSelectionPolicyVersion"), false);
    assert.equal(authorizationDisabled(policy), true);
  }
});

test("authorization stays disabled for unsupported policy integers", () => {
  for (const policy of [0, 1, 3]) {
    assert.equal(projectedPolicy(policy)?.sourceSelectionPolicyVersion, policy);
    assert.equal(authorizationDisabled(policy), true);
  }
});

test("authorization keeps worker, subject, plan-version, and target checks", () => {
  assert.equal(authorizationDisabled(2, { busy: false, workerEnabled: false, taskVersion: 7, planTarget: { baseSha: targetSha } }), true);
  assert.equal(authorizationDisabled(2, { busy: true, workerEnabled: true, taskVersion: 7, planTarget: { baseSha: targetSha } }), true);
  assert.equal(authorizationDisabled(2, { busy: false, workerEnabled: true, taskVersion: 7, planTarget: null, preparedAttempt: projectedPolicy(2) }), true);
  assert.equal(authorizationDisabled(2, { busy: false, workerEnabled: true, taskVersion: 6, planTarget: { baseSha: targetSha } }), true);
  assert.equal(authorizationDisabled(2, { busy: false, workerEnabled: true, taskVersion: 7, planTarget: { baseSha: "a".repeat(40) } }), true);
  assert.equal(authorizationDisabled(2, { busy: false, workerEnabled: true, taskVersion: 7, planTarget: { baseSha: targetSha }, preparedAttempt: null }), true);
  assert.equal(safeTask(task(2, { preparedAttempt: { ...task(2).preparedAttempt as object, attemptId: "not-a-uuid" } })).preparedAttempt, null);
});
