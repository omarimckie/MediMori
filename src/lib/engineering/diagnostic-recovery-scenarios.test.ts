import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEngineeringAdminEventDetails } from "./admin-engineering-event-details";
import { safeBlockDiagnostic } from "./event-diagnostics";
import { prepareValidationEnvironmentDiagnostic } from "./prepare-validation-failure";
import { ValidationPreparationError, withStagingCleanupFailure } from "./validation-diagnostics";
import { buildWorkerExitReport } from "./worker-exit-report";

const revision = "a".repeat(40);

test("primary preparation failure with cleanup failure keeps code in exit report", () => {
  const primary = withStagingCleanupFailure(
    new ValidationPreparationError("validation_source_prepare_failed", "source_volume", "docker_populate_workspace", false, "subprocess_timeout"),
  );
  const diagnostic = prepareValidationEnvironmentDiagnostic(primary, revision);
  const report = buildWorkerExitReport({
    primary: diagnostic,
    cleanupOutcome: "failed",
    cleanupFailures: [{ resourceType: "source-volume", category: "docker_error" }],
    terminalization: { attempted: true, blockRecorded: true },
  });
  assert.equal(report.primary.code, "validation_source_prepare_failed");
  assert.equal(report.cleanupOutcome, "failed");
  assert.notEqual(report.primary.code, "sandbox_cleanup_failed");
});

test("missing cleanup evidence still preserves primary diagnostic code", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(
    new ValidationPreparationError("validation_overlay_prepare_failed", "next_env_overlay", "docker_overlay_init"),
    revision,
  );
  const report = buildWorkerExitReport({
    primary: diagnostic,
    cleanupOutcome: "not_attempted",
    cleanupFailures: [],
    terminalization: { attempted: true, blockRecorded: true },
  });
  assert.equal(report.primary.code, "validation_overlay_prepare_failed");
  assert.equal(report.cleanupOutcome, "not_attempted");
  assert.deepEqual(report.cleanupFailures ?? [], []);
});

test("partial provider persistence surfaces bounded diagnostic without raw progress payloads", () => {
  const projected = projectEngineeringAdminEventDetails("block", {
    diagnostic: {
      stage: "implementation",
      code: "call_progress_persist_failed",
      operation: "provider_call",
      category: "provider_failure",
      cleanupOutcome: "not_attempted",
      progressPhase: "response_processed",
      responseId: "resp_secret_fixture",
      responseStatus: "completed",
      outputTokens: 60,
      outputLimit: 8192,
      rawProviderBody: "must-not-leak",
    },
  });
  const diagnostic = (projected.diagnostic ?? {}) as Record<string, unknown>;
  assert.equal(diagnostic.code, "call_progress_persist_failed");
  assert.equal(diagnostic.operation, "provider_call");
  assert.equal(diagnostic.progressPhase, undefined);
  assert.equal(diagnostic.rawProviderBody, undefined);
  assert.equal(JSON.stringify(projected).includes("must-not-leak"), false);
});

test("ambiguous proposal outcomes keep allowlisted codes in admin projection", () => {
  const safe = safeBlockDiagnostic("block", {
    stage: "implementation",
    code: "replacement_target_ambiguous",
    operation: "apply_proposal",
    category: "proposal_failure",
    cleanupOutcome: "not_attempted",
    message: "Replacement target ambiguous.",
  });
  assert.deepEqual(safe, {
    stage: "implementation",
    code: "replacement_target_ambiguous",
    operation: "apply_proposal",
    category: "proposal_failure",
    cleanupOutcome: "not_attempted",
  });
  const admin = projectEngineeringAdminEventDetails("block", { diagnostic: safe });
  assert.deepEqual(admin.diagnostic, safe);
});
