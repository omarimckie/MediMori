import { safeAdminEventDiagnostic } from "./event-diagnostics";

/**
 * Event-detail projection used by authenticated admin engineering history (`GET` with task id).
 * Kept in a dedicated module so route wiring and regression tests stay aligned without broadening the API schema.
 */
export function projectEngineeringAdminEventDetails(action: unknown, details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const value = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  const stringFields = [
    "kind", "from", "to", "runId", "attemptId", "preparedAttemptId", "command", "outcome", "revision",
    "implementationSourceRevision", "expectedSourceRevision", "actualSourceRevision", "phase", "failureCode", "code",
    "previousRunId", "previousDisposition", "approvalId", "executionId", "baseSha", "commitSha", "targetBranch",
    "targetRepository", "targetBaseSha",
  ];
  for (const key of stringFields) {
    const item = value[key];
    if (typeof item === "string" && item.length <= 240 && /^[\w./:-]*$/.test(item)) safe[key] = item;
  }
  for (const key of ["version", "planVersion", "sourceSelectionPolicyVersion", "cycle", "tokens", "previousAttemptNumber", "preimageCount"]) {
    const item = value[key];
    if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0) safe[key] = item;
  }
  if (typeof value.beforeClaim === "boolean") safe.beforeClaim = value.beforeClaim;
  if (typeof value.estimatedCostUsd === "number" && Number.isFinite(value.estimatedCostUsd) && value.estimatedCostUsd >= 0) {
    safe.estimatedCostUsd = value.estimatedCostUsd;
  }
  if (typeof value.previousDisposition === "string" && value.previousDisposition.length <= 32) {
    safe.previousDisposition = value.previousDisposition;
  }
  Object.assign(safe, safeAdminEventDiagnostic(action, value));
  const evidence = value.proposalEvidence;
  if (action === "proposal_evidence" && evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    const proposal = evidence as Record<string, unknown>;
    const boundedFiles = Array.isArray(proposal.files) ? proposal.files.slice(0, 20).map((item) => {
      const file = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        path: typeof file.path === "string" && file.path.length <= 240 && /^[\w./-]+$/.test(file.path) && !file.path.split("/").includes("..") ? file.path : "[invalid path]",
        beforeSha256: typeof file.beforeSha256 === "string" && /^[a-f0-9]{64}$/.test(file.beforeSha256) ? file.beforeSha256 : "",
        afterSha256: typeof file.afterSha256 === "string" && /^[a-f0-9]{64}$/.test(file.afterSha256) ? file.afterSha256 : "",
        beforeBytes: typeof file.beforeBytes === "number" && Number.isSafeInteger(file.beforeBytes) && file.beforeBytes >= 0 ? file.beforeBytes : 0,
        afterBytes: typeof file.afterBytes === "number" && Number.isSafeInteger(file.afterBytes) && file.afterBytes >= 0 ? file.afterBytes : 0,
        removedLines: typeof file.removedLines === "number" && Number.isSafeInteger(file.removedLines) && file.removedLines >= 0 ? file.removedLines : 0,
        addedLines: typeof file.addedLines === "number" && Number.isSafeInteger(file.addedLines) && file.addedLines >= 0 ? file.addedLines : 0,
      };
    }) : [];
    safe.proposalEvidence = {
      approvedPaths: Array.isArray(proposal.approvedPaths) ? proposal.approvedPaths.slice(0, 20).filter((path): path is string => typeof path === "string" && path.length <= 240 && /^[\w./-]+$/.test(path) && !path.split("/").includes("..")) : [],
      replacementCount: typeof proposal.replacementCount === "number" && Number.isSafeInteger(proposal.replacementCount) && proposal.replacementCount >= 0 && proposal.replacementCount <= 100 ? proposal.replacementCount : 0,
      files: boundedFiles,
      workspaceRevision: typeof proposal.workspaceRevision === "string" && /^[a-f0-9]{40}$/.test(proposal.workspaceRevision) ? proposal.workspaceRevision : "",
    };
  }
  return safe;
}
