import { ApprovedSourceRevisionMismatch } from "./source-binding";
import { TargetAncestryError } from "./merge-target";
import { WorkerInitializationError } from "./worker-initialization";
import { WorkspaceExportError } from "./workspace-export-diagnostics";

export const preclaimDiagnosticStages = [
  "configuration", "scratch_preflight", "database_identity", "lineage_lookup", "target_verification", "target_preimage", "source_export", "claim_preflight",
] as const;
export type PreclaimDiagnosticStage = typeof preclaimDiagnosticStages[number];

export const preclaimDiagnosticCodes = [
  "target_unavailable", "target_object_missing", "target_not_ancestor", "target_preimage_verification_failed",
  "source_revision_mismatch", "workspace_source_export_failed", "worker_identity_or_schema_failure",
  "invalid_lineage_binding", "scratch_storage_preflight_failure", "preclaim_failure",
] as const;
export type PreclaimDiagnosticCode = typeof preclaimDiagnosticCodes[number];

const summaries: Record<PreclaimDiagnosticCode, string> = {
  target_unavailable: "The approved target history could not be verified.",
  target_object_missing: "The approved target commit is unavailable in the target repository.",
  target_not_ancestor: "The approved target commit is not an ancestor of the current target branch.",
  target_preimage_verification_failed: "The approved target file preimage could not be verified.",
  source_revision_mismatch: "The current sanitized implementation source differs from the approved source binding.",
  workspace_source_export_failed: "The sanitized implementation source could not be exported safely.",
  worker_identity_or_schema_failure: "The restricted worker identity or required database schema could not be verified.",
  invalid_lineage_binding: "The approved plan, target, source, or attempt lineage is invalid.",
  scratch_storage_preflight_failure: "The configured engineering scratch storage did not pass preflight.",
  preclaim_failure: "The worker stopped before claim for a bounded setup failure.",
};

export type PreclaimDiagnostic = {
  schemaVersion: 1;
  stage: PreclaimDiagnosticStage;
  code: PreclaimDiagnosticCode;
  summary: string;
  beforeClaim: true;
  providerCouldHaveBeenReached: false;
  dockerCouldHaveBeenReached: false;
};

export class PreclaimWorkerError extends Error {
  constructor(readonly diagnostic: PreclaimDiagnostic) {
    super(diagnostic.summary);
    this.name = "PreclaimWorkerError";
  }
}

export function classifyPreclaimFailure(error: unknown, stage: PreclaimDiagnosticStage): PreclaimDiagnostic {
  let code: PreclaimDiagnosticCode = "preclaim_failure";
  if (error instanceof TargetAncestryError) {
    code = error.code === "target_commit_missing" ? "target_object_missing"
      : error.code === "target_not_ancestor" ? "target_not_ancestor" : "target_unavailable";
  } else if (error instanceof ApprovedSourceRevisionMismatch) {
    code = "source_revision_mismatch";
  } else if (error instanceof WorkspaceExportError) {
    code = "workspace_source_export_failed";
  } else if (error instanceof WorkerInitializationError) {
    code = error.stage === "scratch_preflight" ? "scratch_storage_preflight_failure"
      : error.stage === "database_identity" ? "worker_identity_or_schema_failure"
      : "preclaim_failure";
  } else if (stage === "lineage_lookup") {
    code = "invalid_lineage_binding";
  } else if (stage === "target_verification") {
    code = "target_unavailable";
  } else if (stage === "source_export") {
    code = "workspace_source_export_failed";
  } else if (stage === "scratch_preflight") {
    code = "scratch_storage_preflight_failure";
  } else if (stage === "database_identity") {
    code = "worker_identity_or_schema_failure";
  }
  return {
    schemaVersion: 1,
    stage,
    code,
    summary: summaries[code],
    beforeClaim: true,
    providerCouldHaveBeenReached: false,
    dockerCouldHaveBeenReached: false,
  };
}

export function preclaimDiagnosticSummaries() {
  return { ...summaries };
}

export function preclaimDiagnosticToJson(diagnostic: PreclaimDiagnostic) {
  // Reconstruct from allow-listed fields; never forward exception metadata.
  if (!preclaimDiagnosticStages.includes(diagnostic.stage) || !preclaimDiagnosticCodes.includes(diagnostic.code)) {
    return classifyPreclaimFailure(undefined, "claim_preflight");
  }
  return {
    schemaVersion: 1 as const,
    stage: diagnostic.stage,
    code: diagnostic.code,
    summary: summaries[diagnostic.code],
    beforeClaim: true as const,
    providerCouldHaveBeenReached: false as const,
    dockerCouldHaveBeenReached: false as const,
  };
}
