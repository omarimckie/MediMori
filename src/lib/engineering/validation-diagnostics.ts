import { commandArgs } from "./worker-policy";
import { validationPreparationOperations, type ValidationPreparationOperation } from "./validation-source-populate";
import { boundedValidationExcerpt, sanitizeValidationLabel } from "../../../scripts/validation-diagnostic-excerpt.mjs";

export { sanitizeValidationLabel, boundedValidationExcerpt };

export const validationFailureCategories = [
  "command_failed",
  "process_signaled",
  "process_spawn_failed",
  "validation_timeout",
  "docker_unavailable",
  "validation_protocol_error",
] as const;
export type ValidationFailureCategory = typeof validationFailureCategories[number];
export const validationPreparationCodes = [
  "validation_source_prepare_failed",
  "validation_overlay_prepare_failed",
  "validation_dependency_unavailable",
  "validation_image_unavailable",
  "validation_executor_unavailable",
] as const;
export type ValidationPreparationCode = typeof validationPreparationCodes[number];
export type ValidationPreparationStage = "docker_preflight" | "image_check" | "dependency_check" | "source_volume" | "next_env_overlay";
export type { ValidationPreparationOperation };
export const preparationFailureClasses = [
  "subprocess_nonzero_exit",
  "subprocess_timeout",
  "filesystem_operation_failed",
  "docker_process_failed",
  "preparation_failure",
] as const;
export type PreparationFailureClass = typeof preparationFailureClasses[number];
const filesystemErrorCodes = new Set(["EBUSY", "EACCES", "EEXIST", "EINVAL", "EIO", "EISDIR", "ELOOP", "EMFILE", "ENAMETOOLONG", "ENOENT", "ENOSPC", "ENOTDIR", "EPERM", "EROFS"]);

/** Classifies a caught preparation error from its code only. Messages, stderr, and paths are ignored. */
export function classifyPreparationFailure(error: unknown): PreparationFailureClass {
  if (!error || typeof error !== "object") return "preparation_failure";
  const code = "code" in error ? error.code : undefined;
  const killed = "killed" in error ? error.killed : undefined;
  if (code === "ETIMEDOUT" || killed === true) return "subprocess_timeout";
  if (code === "DOCKER_POPULATE_FAILED") return "docker_process_failed";
  if (code === "TAR_FAILED" || typeof code === "number" && Number.isInteger(code) && code !== 0) return "subprocess_nonzero_exit";
  if (typeof code === "string" && filesystemErrorCodes.has(code)) return "filesystem_operation_failed";
  return "preparation_failure";
}

export class ValidationPreparationError extends Error {
  readonly operation?: ValidationPreparationOperation;
  readonly stagingCleanupFailed: boolean;
  readonly failureClass?: PreparationFailureClass;
  constructor(
    readonly code: ValidationPreparationCode,
    readonly stage: ValidationPreparationStage,
    operation?: ValidationPreparationOperation,
    stagingCleanupFailed = false,
    failureClass?: PreparationFailureClass,
  ) {
    super("Validation environment preparation failed.");
    this.name = "ValidationPreparationError";
    this.operation = operation && (validationPreparationOperations as readonly string[]).includes(operation) ? operation : undefined;
    this.stagingCleanupFailed = stagingCleanupFailed;
    this.failureClass = failureClass && (preparationFailureClasses as readonly string[]).includes(failureClass) ? failureClass : undefined;
  }
}

/** Keeps the primary preparation failure when disposable staging cleanup also fails. */
export function withStagingCleanupFailure(primary: ValidationPreparationError): ValidationPreparationError {
  if (primary.stagingCleanupFailed) return primary;
  return new ValidationPreparationError(primary.code, primary.stage, primary.operation, true, primary.failureClass);
}
export type ValidationEvidence = {
  revision: string;
  command: string;
  outcome: "passed" | "failed";
  exitCode: number | null;
  containerExitCode: number | null;
  containerStatus: "created" | "running" | "exited" | "dead" | "removing" | null;
  containerOomKilled: boolean | null;
  signal: string | null;
  timedOut: boolean;
  category: ValidationFailureCategory | null;
  excerpt: string[];
  failedTests: string[];
  failedTestFiles: string[];
  cycle: number;
};

const signals = new Set(["SIGABRT", "SIGBUS", "SIGFPE", "SIGILL", "SIGKILL", "SIGSEGV", "SIGTERM"]);

export function makeValidationEvidence(input: {
  revision: string; command: string; exitCode: number | null; signal?: string | null;
  timedOut?: boolean; dockerError?: boolean; protocolError?: boolean; output?: string; failedTestFiles?: string[];
  containerExitCode?: number | null; containerStatus?: ValidationEvidence["containerStatus"]; containerOomKilled?: boolean | null; cycle: number;
}): ValidationEvidence {
  commandArgs(input.command);
  if (!/^[a-f0-9]{40}$/.test(input.revision) || !Number.isInteger(input.cycle) || input.cycle < 0 || input.cycle > 3) throw new Error("Invalid validation identity.");
  const signal = input.signal && signals.has(input.signal) ? input.signal : null;
  const timedOut = input.timedOut === true;
  const result = boundedValidationExcerpt(input.command, (input.output ?? "").slice(0, 1024 * 1024));
  const outcome = input.exitCode === 0 && !signal && !timedOut && !input.dockerError ? "passed" : "failed";
  const category: ValidationFailureCategory | null = outcome === "passed" ? null
    : timedOut ? "validation_timeout"
      : input.dockerError ? "docker_unavailable"
        : input.protocolError ? "validation_protocol_error"
        : signal ? "process_signaled"
          : input.exitCode === null ? "process_spawn_failed"
            : "command_failed";
  const reportedFiles = (input.failedTestFiles ?? []).filter(path => /^src\/lib\/engineering\/[A-Za-z0-9_.-]+\.test\.tsx?$/.test(path));
  return { revision: input.revision, command: input.command, outcome, exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null, containerExitCode: Number.isInteger(input.containerExitCode) ? input.containerExitCode! : null, containerStatus: input.containerStatus ?? null, containerOomKilled: typeof input.containerOomKilled === "boolean" ? input.containerOomKilled : null, signal, timedOut, category, excerpt: result.excerpt, failedTests: result.failedTests, failedTestFiles: [...new Set([...result.failedTestFiles, ...reportedFiles])].slice(0, 8), cycle: input.cycle };
}

/** Validate persisted/repair-facing evidence and strip every unknown field. */
export function normalizeValidationEvidence(value: unknown): Omit<ValidationEvidence, "revision" | "cycle"> | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  try { commandArgs(String(item.command)); } catch { return null; }
  if (!["passed", "failed"].includes(String(item.outcome)) || !(item.exitCode === undefined || item.exitCode === null || Number.isInteger(item.exitCode)) || !(item.containerExitCode === undefined || item.containerExitCode === null || Number.isInteger(item.containerExitCode)) || !(item.containerStatus === undefined || item.containerStatus === null || ["created","running","exited","dead","removing"].includes(String(item.containerStatus))) || !(item.containerOomKilled === undefined || item.containerOomKilled === null || typeof item.containerOomKilled === "boolean") || !(item.signal === undefined || item.signal === null || typeof item.signal === "string" && signals.has(item.signal)) || !(item.timedOut === undefined || typeof item.timedOut === "boolean")) return null;
  const category = item.category === null || validationFailureCategories.includes(item.category as ValidationFailureCategory) ? item.category as ValidationFailureCategory | null : null;
  const list = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 8).map(entry => sanitizeValidationLabel(entry).slice(0, 240)) : [];
  const failedTestFiles = Array.isArray(item.failedTestFiles) ? item.failedTestFiles.filter((entry): entry is string => typeof entry === "string" && /^src\/lib\/engineering\/[A-Za-z0-9_.-]+\.test\.tsx?$/.test(entry)).slice(0, 8) : [];
  const outcome = item.outcome as "passed" | "failed";
  return { command: String(item.command), outcome, exitCode: item.exitCode === undefined ? outcome === "passed" ? 0 : 1 : item.exitCode as number | null, containerExitCode: item.containerExitCode === undefined ? null : item.containerExitCode as number | null, containerStatus: item.containerStatus === undefined ? null : item.containerStatus as ValidationEvidence["containerStatus"], containerOomKilled: item.containerOomKilled === undefined ? null : item.containerOomKilled as boolean | null, signal: item.signal === undefined ? null : item.signal as string | null, timedOut: item.timedOut === true, category: category ?? (outcome === "failed" ? "command_failed" : null), excerpt: list(item.excerpt), failedTests: list(item.failedTests), failedTestFiles };
}
