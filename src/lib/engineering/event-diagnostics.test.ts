import { test } from "node:test";
import assert from "node:assert/strict";
import { safeAdminEventDiagnostic, safeBlockDiagnostic } from "./event-diagnostics";

test("block event history exposes only bounded allowlisted diagnostic classifications", () => {
  const safe = safeBlockDiagnostic("block", {
    code: "validation_dependency_unavailable",
    stage: "worker",
    validationStage: "dependency_check",
    operation: "prepare_validation_environment",
    category: "validation_failure",
    cleanupOutcome: "succeeded",
    message: "private-sentinel",
    stack: "private-stack",
    secret: "private-secret",
    nested: { arbitrary: true },
  });
  assert.deepEqual(safe, { operation: "prepare_validation_environment", category: "validation_failure", cleanupOutcome: "succeeded", code: "validation_dependency_unavailable", stage: "worker", validationStage: "dependency_check" });
  assert.equal(JSON.stringify(safe).includes("private"), false);
});

test("event details omit unknown, oversized, malformed, and non-block diagnostics", () => {
  assert.equal(safeBlockDiagnostic("block", { code: "x".repeat(81), stage: "not-a-stage", validationStage: "implementation", message: "raw" }), undefined);
  assert.equal(safeBlockDiagnostic("validation", { code: "worker_failure", stage: "worker" }), undefined);
  assert.equal(safeBlockDiagnostic("block", ["worker_failure", "worker"]), undefined);
});

test("event details independently omit invalid operation, category, and cleanup outcome", () => {
  const base = { code: "worker_failure", stage: "worker" };
  assert.deepEqual(safeBlockDiagnostic("block", { ...base, operation: "provider_call;secret" }), base);
  assert.deepEqual(safeBlockDiagnostic("block", { ...base, category: "cleanup_failure;secret" }), base);
  assert.deepEqual(safeBlockDiagnostic("block", { ...base, cleanupOutcome: "failed;secret" }), base);
});

test("authenticated admin GET diagnostic projection retains safe classifications only", () => {
  const projected = safeAdminEventDiagnostic("block", { diagnostic: { operation: "workspace_cleanup", category: "cleanup_failure", cleanupOutcome: "failed", code: "sandbox_cleanup_failed", stage: "worker", cleanupFailures: [{ resourceType: "source-volume", category: "resource_in_use" }], message: "private-sentinel", stack: "private-stack" } });
  assert.deepEqual(projected, { diagnostic: { operation: "workspace_cleanup", category: "cleanup_failure", cleanupOutcome: "failed", code: "sandbox_cleanup_failed", stage: "worker" } });
  assert.equal(JSON.stringify(projected).includes("private"), false);
  assert.equal(JSON.stringify(projected).includes("resource_in_use"), false);
});
