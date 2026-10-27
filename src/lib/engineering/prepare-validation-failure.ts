import { DockerCleanupError } from "./docker-ownership";
import { EngineeringInputError } from "./policy";
import { classifyPreparationFailure, ValidationPreparationError, type ValidationPreparationStage } from "./validation-diagnostics";
import type { WorkerDiagnostic } from "./worker";

type PrepareWorkerDiagnostic = Pick<
  WorkerDiagnostic,
  "stage" | "operation" | "category" | "code" | "validationStage" | "validationRevision" | "validationPreparationOperation" | "preparationFailureClass" | "cleanupOutcome" | "cleanupFailures"
>;

/** Maps prepareValidationEnvironment failures to bounded worker diagnostics. */
export function prepareValidationEnvironmentDiagnostic(error: unknown, validationRevision: string): PrepareWorkerDiagnostic {
  if (error instanceof ValidationPreparationError) {
    return {
      stage: "worker",
      operation: "prepare_validation_environment",
      category: "validation_failure",
      code: error.code,
      validationStage: error.stage,
      validationRevision,
      ...(error.operation ? { validationPreparationOperation: error.operation } : {}),
      ...(error.failureClass ? { preparationFailureClass: error.failureClass } : {}),
      ...(error.stagingCleanupFailed ? { cleanupOutcome: "failed" as const } : {}),
    };
  }
  if (error instanceof DockerCleanupError) {
    return {
      stage: "worker",
      operation: "workspace_cleanup",
      category: "cleanup_failure",
      code: "sandbox_cleanup_failed",
      validationStage: "source_volume",
      validationRevision,
      cleanupOutcome: "failed",
      cleanupFailures: error.cleanupFailures.slice(0, 16),
    };
  }
  if (error instanceof EngineeringInputError) {
    const mapped = mapEngineeringInputPrepareFailure(error.message);
    return {
      stage: "worker",
      operation: "prepare_validation_environment",
      category: "validation_failure",
      code: mapped.code,
      validationStage: mapped.validationStage,
      validationRevision,
      preparationFailureClass: mapped.failureClass,
    };
  }
  return {
    stage: "worker",
    operation: "prepare_validation_environment",
    category: "validation_failure",
    code: "validation_source_prepare_failed",
    validationStage: "source_volume",
    validationRevision,
    preparationFailureClass: classifyPreparationFailure(error),
  };
}

function mapEngineeringInputPrepareFailure(message: string): { code: PrepareWorkerDiagnostic["code"]; validationStage: ValidationPreparationStage | "validation_environment_prepare"; failureClass: "preparation_failure" } {
  if (message === "Validation revision changed before environment preparation.") {
    return { code: "post_apply_revision_mismatch", validationStage: "validation_environment_prepare", failureClass: "preparation_failure" };
  }
  if (message === "Workspace changed before volume population.") {
    return { code: "validation_source_prepare_failed", validationStage: "source_volume", failureClass: "preparation_failure" };
  }
  if (message === "Unsafe exported path." || message === "Unsafe Next.js declaration file." || message === "Secret detected; context export refused." || message === "Next.js declaration file differs from the approved source revision.") {
    return { code: "validation_source_prepare_failed", validationStage: "source_volume", failureClass: "preparation_failure" };
  }
  return { code: "validation_source_prepare_failed", validationStage: "source_volume", failureClass: "preparation_failure" };
}
