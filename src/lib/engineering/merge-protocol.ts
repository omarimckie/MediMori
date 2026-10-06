import { createHash } from "node:crypto";
import { EngineeringInputError } from "./policy";
import { isSafeMergeRelativePath, mergeTargetPolicy, type MergeTarget } from "./merge-policy";

export type MergeFileBinding = { path: string; beforeSha256: string; afterSha256: string };
export type MergeBinding = {
  taskId: string; taskVersion: number; runId: string; attemptNumber: number; planVersion: number; resultingRevision: string;
  files: MergeFileBinding[]; target: MergeTarget; targetBaseSha: string; actor: string; idempotencyKey: string;
};
export type MergeApprovalRecord = MergeBinding & { id: string; status: "approved" | "rejected" | "revoked" | "consumed" | "blocked"; approvedAt: string; commitSha?: string | null };
export type MergeCandidate = { taskId: string; taskVersion: number; taskStatus: string; runId: string; runSucceeded: boolean; attemptNumber: number; planVersion: number; resultingRevision: string; files: MergeFileBinding[]; requiredValidations: string[]; passedValidations: string[]; selfReviewPassed: boolean };

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const sha1 = /^[a-f\d]{40}$/;
const sha256 = /^[a-f\d]{64}$/;

export function canonicalMergeFiles(value: unknown): MergeFileBinding[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new EngineeringInputError("Merge file set is invalid.");
  const files = value.map((entry): MergeFileBinding => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new EngineeringInputError("Merge file binding is invalid.");
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "afterSha256,beforeSha256,path" || !isSafeMergeRelativePath(String(item.path)) || !sha256.test(String(item.beforeSha256)) || !sha256.test(String(item.afterSha256))) throw new EngineeringInputError("Merge file binding is invalid.");
    return { path: item.path as string, beforeSha256: item.beforeSha256 as string, afterSha256: item.afterSha256 as string };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map(file => file.path)).size !== files.length) throw new EngineeringInputError("Merge file set contains duplicates.");
  return files;
}

export function validateMergeBinding(value: MergeBinding): MergeBinding {
  if (!uuid.test(value.taskId) || !uuid.test(value.runId) || !uuid.test(value.idempotencyKey) || !Number.isSafeInteger(value.taskVersion) || value.taskVersion < 0 || !Number.isSafeInteger(value.attemptNumber) || value.attemptNumber < 1 || !Number.isSafeInteger(value.planVersion) || value.planVersion < 0 || !sha1.test(value.resultingRevision) || !sha1.test(value.targetBaseSha) || !value.actor.trim() || value.actor.length > 120) throw new EngineeringInputError("Merge approval binding is invalid.");
  if (value.target.repository !== mergeTargetPolicy.repository || value.target.branch !== mergeTargetPolicy.branch || value.target.remote !== mergeTargetPolicy.remote) throw new EngineeringInputError("Merge target is not approved by project policy.");
  const files = canonicalMergeFiles(value.files);
  return { ...value, files };
}

/** Compares a durable human approval with the current authoritative candidate. */
export function verifyMergeCandidate(approval: MergeBinding, candidate: MergeCandidate) {
  validateMergeBinding(approval);
  if (!["awaiting_merge", "merging"].includes(candidate.taskStatus) || !candidate.runSucceeded ||
    candidate.taskVersion !== approval.taskVersion && !(candidate.taskStatus === "merging" && candidate.taskVersion === approval.taskVersion + 1) ||
    approval.taskId !== candidate.taskId || approval.runId !== candidate.runId ||
    approval.attemptNumber !== candidate.attemptNumber || approval.planVersion !== candidate.planVersion ||
    approval.resultingRevision !== candidate.resultingRevision || !candidate.selfReviewPassed) throw new EngineeringInputError("Merge approval no longer matches the successful reviewed result.");
  const approved = canonicalMergeFiles(approval.files);
  const current = canonicalMergeFiles(candidate.files);
  if (JSON.stringify(approved) !== JSON.stringify(current)) throw new EngineeringInputError("Merge approval file set or hash binding changed.");
  const required = [...new Set(candidate.requiredValidations)].sort();
  const passed = [...new Set(candidate.passedValidations)].sort();
  if (!required.length || required.some(command => !passed.includes(command))) throw new EngineeringInputError("Required validation evidence is incomplete.");
}

export type MergeSource = { revision: string; files: Record<string, Uint8Array> };
export function verifyMergeSource(binding: MergeBinding, source: MergeSource) {
  const checked = validateMergeBinding(binding);
  if (source.revision !== checked.resultingRevision) throw new EngineeringInputError("Reviewed source revision changed.");
  const actualPaths = Object.keys(source.files).sort();
  const approvedPaths = checked.files.map(file => file.path);
  if (actualPaths.length !== approvedPaths.length || actualPaths.some((path, index) => path !== approvedPaths[index])) throw new EngineeringInputError("Reviewed source file set changed.");
  for (const file of checked.files) {
    const content = source.files[file.path];
    if (!content || createHash("sha256").update(content).digest("hex") !== file.afterSha256) throw new EngineeringInputError("Reviewed source hash changed.");
  }
}

export type TargetSnapshot = { baseSha: string; files: Record<string, Uint8Array | null> };
/** Unrelated branch drift is allowed only when every approved target still has the reviewed before hash. */
export function verifyTargetSnapshot(binding: MergeBinding, target: TargetSnapshot) {
  validateMergeBinding(binding);
  if (!sha1.test(target.baseSha)) throw new EngineeringInputError("Target branch revision is invalid.");
  for (const file of binding.files) {
    const content = target.files[file.path];
    const actual = content === null || content === undefined ? null : createHash("sha256").update(content).digest("hex");
    if (actual !== file.beforeSha256) throw new EngineeringInputError("Target file changed after human review.");
  }
  return { approvedBaseSha: binding.targetBaseSha, executionBaseSha: target.baseSha, unrelatedDrift: target.baseSha !== binding.targetBaseSha };
}

export type MergeExecutionState = "approved" | "started" | "target_verified" | "diff_verified" | "commit_created" | "push_attempted" | "pushed" | "remote_verified" | "completed" | "blocked";
export type MergeExecutionEvent = { stage: MergeExecutionState; approvalId: string; taskId: string; runId: string; targetBranch: string; baseSha?: string; commitSha?: string; code?: string };

export function mergeApprovalFingerprint(binding: MergeBinding) {
  const checked = validateMergeBinding(binding);
  return createHash("sha256").update(JSON.stringify({ ...checked, files: canonicalMergeFiles(checked.files) })).digest("hex");
}
