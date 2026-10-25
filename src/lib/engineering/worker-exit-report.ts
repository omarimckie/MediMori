import type { CleanupFailure } from "./docker-ownership";
import { EngineeringInputError } from "./policy";
import { safeBlockDiagnostic } from "./event-diagnostics";
import type { WorkerDiagnostic } from "./worker";

export type WorkerTerminalizationEvidence = {
  attempted: boolean;
  blockRecorded: boolean;
  ingressError?: string;
};

export type WorkerExitReport = {
  schemaVersion: 1;
  summary: string;
  primary: Record<string, unknown>;
  cleanupOutcome: NonNullable<WorkerDiagnostic["cleanupOutcome"]>;
  cleanupFailures?: CleanupFailure[];
  terminalization: WorkerTerminalizationEvidence;
  durableDisposition: "blocked" | "unknown";
  beforeClaim: false;
};

export class WorkerExitError extends EngineeringInputError {
  constructor(readonly report: WorkerExitReport) {
    super("Worker stopped; inspect bounded diagnostics.");
  }
}

const exitSummaries: Partial<Record<WorkerDiagnostic["code"], string>> = {
  runtime_deadline_exceeded: "The authorized runtime window did not leave enough time to complete validation or terminalization safely.",
  lease_or_fence_lost: "The worker lost its lease or authorization fence before terminalization completed.",
  sandbox_cleanup_failed: "Workspace cleanup failed after the primary worker failure.",
  worker_failure: "The worker stopped for a bounded runtime failure.",
};

const primaryScalarKeys = [
  "validationGate",
  "validationRevision",
  "responseId",
  "responseStatus",
  "incompleteReason",
  "progressPhase",
  "shapeCategory",
] as const;

export function sanitizePrimaryDiagnostic(diagnostic: WorkerDiagnostic): Record<string, unknown> {
  const safe = safeBlockDiagnostic("block", diagnostic) ?? {};
  const primary: Record<string, unknown> = { ...safe };
  if (!primary.stage && diagnostic.stage) primary.stage = diagnostic.stage;
  if (!primary.code && diagnostic.code) primary.code = diagnostic.code;
  for (const key of primaryScalarKeys) {
    const value = diagnostic[key];
    if (typeof value === "string" && value.length <= 120) primary[key] = value;
  }
  if (typeof diagnostic.outputTokens === "number" && Number.isSafeInteger(diagnostic.outputTokens) && diagnostic.outputTokens >= 0) primary.outputTokens = diagnostic.outputTokens;
  if (typeof diagnostic.outputLimit === "number" && Number.isSafeInteger(diagnostic.outputLimit) && diagnostic.outputLimit >= 0) primary.outputLimit = diagnostic.outputLimit;
  if (typeof diagnostic.replacementCount === "number" && Number.isSafeInteger(diagnostic.replacementCount) && diagnostic.replacementCount >= 0) primary.replacementCount = diagnostic.replacementCount;
  if (diagnostic.cleanupFailures?.length) primary.cleanupFailures = boundedCleanupFailures(diagnostic.cleanupFailures);
  return primary;
}

export function boundedCleanupFailures(failures: CleanupFailure[]): CleanupFailure[] {
  return failures.slice(0, 16).map(item => ({ resourceType: item.resourceType, category: item.category }));
}

export function buildWorkerExitReport(input: {
  primary: WorkerDiagnostic;
  cleanupOutcome: NonNullable<WorkerDiagnostic["cleanupOutcome"]>;
  cleanupFailures: CleanupFailure[];
  terminalization: WorkerTerminalizationEvidence;
}): WorkerExitReport {
  const primary = sanitizePrimaryDiagnostic(input.primary);
  const code = typeof primary.code === "string" ? primary.code : input.primary.code;
  const summary = (code && exitSummaries[code as WorkerDiagnostic["code"]]) ?? "The worker stopped; inspect bounded diagnostics and durable records.";
  return {
    schemaVersion: 1,
    summary,
    primary,
    cleanupOutcome: input.cleanupOutcome,
    ...(input.cleanupFailures.length ? { cleanupFailures: boundedCleanupFailures(input.cleanupFailures) } : {}),
    terminalization: {
      attempted: input.terminalization.attempted,
      blockRecorded: input.terminalization.blockRecorded,
      ...(input.terminalization.ingressError ? { ingressError: input.terminalization.ingressError.slice(0, 120) } : {}),
    },
    durableDisposition: input.terminalization.blockRecorded ? "blocked" : "unknown",
    beforeClaim: false,
  };
}

export function workerExitReportToJson(report: WorkerExitReport) {
  return {
    schemaVersion: 1 as const,
    summary: report.summary,
    primary: report.primary,
    cleanupOutcome: report.cleanupOutcome,
    ...(report.cleanupFailures?.length ? { cleanupFailures: report.cleanupFailures } : {}),
    terminalization: report.terminalization,
    durableDisposition: report.durableDisposition,
    beforeClaim: false as const,
  };
}
