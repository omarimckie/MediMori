import test from "node:test";
import assert from "node:assert/strict";
import { DockerCleanupError } from "./docker-ownership";
import { EngineeringInputError } from "./policy";
import { prepareValidationEnvironmentDiagnostic } from "./prepare-validation-failure";
import { ValidationPreparationError } from "./validation-diagnostics";

const revision = "d".repeat(40);

test("primary preparation failure retains stage, code, and operation", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(
    new ValidationPreparationError("validation_overlay_prepare_failed", "next_env_overlay", "docker_overlay_init"),
    revision,
  );
  assert.equal(diagnostic.code, "validation_overlay_prepare_failed");
  assert.equal(diagnostic.validationStage, "next_env_overlay");
  assert.equal(diagnostic.validationPreparationOperation, "docker_overlay_init");
  assert.equal(diagnostic.cleanupOutcome, undefined);
});

test("primary preparation failure followed by cleanup failure records cleanupOutcome failed", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(
    new ValidationPreparationError("validation_source_prepare_failed", "source_volume", "docker_populate_workspace", true),
    revision,
  );
  assert.equal(diagnostic.code, "validation_source_prepare_failed");
  assert.equal(diagnostic.validationStage, "source_volume");
  assert.equal(diagnostic.validationPreparationOperation, "docker_populate_workspace");
  assert.equal(diagnostic.cleanupOutcome, "failed");
});

test("cleanup-only failure maps to sandbox cleanup diagnostic", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(
    new DockerCleanupError([{ resourceType: "source-volume", category: "docker_error" }]),
    revision,
  );
  assert.equal(diagnostic.code, "sandbox_cleanup_failed");
  assert.equal(diagnostic.category, "cleanup_failure");
  assert.equal(diagnostic.operation, "workspace_cleanup");
  assert.equal(diagnostic.cleanupOutcome, "failed");
  assert.equal(diagnostic.cleanupFailures?.length, 1);
});

test("known engineering input errors map to defensible diagnostics", () => {
  const revisionMismatch = prepareValidationEnvironmentDiagnostic(
    new EngineeringInputError("Validation revision changed before environment preparation."),
    revision,
  );
  assert.equal(revisionMismatch.code, "post_apply_revision_mismatch");
  assert.equal(revisionMismatch.validationStage, "validation_environment_prepare");

  const volumeRevision = prepareValidationEnvironmentDiagnostic(
    new EngineeringInputError("Workspace changed before volume population."),
    revision,
  );
  assert.equal(volumeRevision.code, "validation_source_prepare_failed");
  assert.equal(volumeRevision.validationStage, "source_volume");
});

test("unknown preparation errors use bounded generic fallback", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(new EngineeringInputError("Unexpected auxiliary failure."), revision);
  assert.equal(diagnostic.code, "validation_source_prepare_failed");
  assert.equal(diagnostic.validationStage, "source_volume");
  const unknown = prepareValidationEnvironmentDiagnostic(new Error("unclassified"), revision);
  assert.equal(unknown.code, "validation_source_prepare_failed");
  assert.equal(unknown.validationStage, "source_volume");
});
