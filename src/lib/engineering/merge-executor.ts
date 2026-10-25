import { validateMergeBinding, verifyMergeSource, verifyTargetSnapshot, type MergeApprovalRecord, type MergeExecutionEvent, type MergeSource, type TargetSnapshot } from "./merge-protocol";

export type MergeExecutorStore = {
  loadApproval(id: string): Promise<MergeApprovalRecord | null>;
  start(approval: MergeApprovalRecord): Promise<void>;
  progress(event: MergeExecutionEvent): Promise<void>;
  complete(approval: MergeApprovalRecord, commitSha: string): Promise<void>;
  block(approval: MergeApprovalRecord, code: string): Promise<void>;
};
export type MergeExecutorGit = {
  findRemoteCommitForApproval(approval: MergeApprovalRecord): Promise<string | null>;
  readCleanTarget(approval: MergeApprovalRecord): Promise<TargetSnapshot>;
  readReviewedSource(approval: MergeApprovalRecord): Promise<MergeSource>;
  applyApprovedFiles(approval: MergeApprovalRecord, source: MergeSource): Promise<{ changedPaths: string[]; afterHashes: Record<string, string> }>;
  validateAppliedDiff(approval: MergeApprovalRecord): Promise<void>;
  createCommit(approval: MergeApprovalRecord): Promise<string>;
  push(approval: MergeApprovalRecord, commitSha: string): Promise<void>;
  verifyRemote(approval: MergeApprovalRecord, commitSha: string): Promise<boolean>;
};

const boundedCodes = new Set(["target_changed", "source_revision_mismatch", "file_hash_mismatch", "scope_mismatch", "validation_failed", "git_operation_failed", "remote_verification_failed", "approval_invalid", "executor_configuration_invalid"]);
export class MergeExecutionError extends Error {
  constructor(readonly code: string) { super("Merge execution stopped safely."); }
}

/** Idempotent orchestrator. Git and database side effects are isolated behind explicit adapters. */
export async function executeApprovedMerge(id: string, store: MergeExecutorStore, git: MergeExecutorGit) {
  const approval = await store.loadApproval(id);
  if (approval?.status === "consumed" && approval.commitSha) {
    if (!(await git.verifyRemote(approval, approval.commitSha))) throw new MergeExecutionError("remote_verification_failed");
    return { commitSha: approval.commitSha, recoveredAfterPush: true };
  }
  if (!approval || approval.status !== "approved") throw new MergeExecutionError("approval_invalid");
  validateMergeBinding(approval);
  await store.start(approval);
  let stage: "before_push" | "push_started" | "pushed" = "before_push";
  try {
    // Recover a crash after remote push before doing any second commit/push.
    const recovered = await git.findRemoteCommitForApproval(approval);
    if (recovered) {
      if (!(await git.verifyRemote(approval, recovered))) throw new MergeExecutionError("remote_verification_failed");
      await store.progress({ stage: "remote_verified", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, commitSha: recovered });
      await store.complete(approval, recovered);
      return { commitSha: recovered, recoveredAfterPush: true };
    }

    const target = await git.readCleanTarget(approval);
    try { verifyTargetSnapshot(approval, target); }
    catch { throw new MergeExecutionError("target_changed"); }
    await store.progress({ stage: "target_verified", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, baseSha: target.baseSha });

    const source = await git.readReviewedSource(approval);
    try { verifyMergeSource(approval, source); }
    catch { throw new MergeExecutionError("source_revision_mismatch"); }
    const applied = await git.applyApprovedFiles(approval, source);
    const expectedPaths = approval.files.map(file => file.path).sort();
    if (applied.changedPaths.slice().sort().join("\0") !== expectedPaths.join("\0")) throw new MergeExecutionError("scope_mismatch");
    for (const file of approval.files) if (applied.afterHashes[file.path] !== file.afterSha256) throw new MergeExecutionError("file_hash_mismatch");
    await store.progress({ stage: "diff_verified", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, baseSha: target.baseSha });
    await git.validateAppliedDiff(approval);

    const commitSha = await git.createCommit(approval);
    if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new MergeExecutionError("git_operation_failed");
    await store.progress({ stage: "commit_created", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, baseSha: target.baseSha, commitSha });
    stage = "push_started";
    await store.progress({ stage: "push_attempted", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, baseSha: target.baseSha, commitSha });
    await git.push(approval, commitSha);
    stage = "pushed";
    await store.progress({ stage: "pushed", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, baseSha: target.baseSha, commitSha });
    if (!(await git.verifyRemote(approval, commitSha))) throw new MergeExecutionError("remote_verification_failed");
    await store.progress({ stage: "remote_verified", approvalId: approval.id, taskId: approval.taskId, runId: approval.runId, targetBranch: approval.target.branch, baseSha: target.baseSha, commitSha });
    await store.complete(approval, commitSha);
    return { commitSha, recoveredAfterPush: false };
  } catch (error) {
    // Once push might have started, retain the approved execution for safe
    // recovery. Never mark it blocked based on an ambiguous network result.
    if (stage === "before_push") {
      const code = error instanceof MergeExecutionError && boundedCodes.has(error.code) ? error.code : "git_operation_failed";
      await store.block(approval, code);
    }
    throw error instanceof MergeExecutionError ? error : new MergeExecutionError(stage === "pushed" ? "remote_verification_failed" : "git_operation_failed");
  }
}
