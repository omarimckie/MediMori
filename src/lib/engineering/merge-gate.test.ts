import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { getSql } from "@/lib/db";
import { assertTransition } from "./policy";
import { canonicalMergeFiles, mergeApprovalFingerprint, validateMergeBinding, verifyMergeCandidate, verifyMergeSource, verifyTargetSnapshot, type MergeApprovalRecord, type MergeExecutionEvent } from "./merge-protocol";
import { executeApprovedMerge, type MergeExecutorGit, type MergeExecutorStore } from "./merge-executor";
import { IsolatedMergeGitAdapter, mergeGitProcessEnvironment, mergePushArguments } from "./merge-git-adapter";
import { mergeTargetPolicy } from "./merge-policy";
import { recordMergeDecision } from "./store";
import { readTargetPreimagesAtSha } from "./merge-target";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const revision = "1".repeat(40);
const taskId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const approvalId = "33333333-3333-4333-8333-333333333333";
const before = "Reviewed sentence before the merge.\n";
const after = "Reviewed sentence after the merge.\n";
const file = { path: "docs/engineering-agent.md", beforeSha256: sha(before), afterSha256: sha(after) };

test("merge Git child trusts only its exact Windows scratch checkout without global config", () => {
  const checkout = "D:\\MediMori-Engineering\\merge-executor\\run\\target";
  const env = mergeGitProcessEnvironment(checkout);
  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
  assert.equal(env.GIT_CONFIG_VALUE_0, "D:/MediMori-Engineering/merge-executor/run/target");
  assert.equal(env.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ENGINEERING_MERGE_DATABASE_URL, undefined);
  assert.deepEqual(mergePushArguments(binding()), ["push", "origin", "HEAD:refs/heads/main"]);
  assert.equal(mergePushArguments(binding()).includes("--force"), false);
});

function binding(): MergeApprovalRecord {
  return {
    id: approvalId, taskId, taskVersion: 39, runId, attemptNumber: 7, planVersion: 35, resultingRevision: revision,
    files: [file], target: { ...mergeTargetPolicy }, targetBaseSha: "4".repeat(40), actor: "human-reviewer",
    idempotencyKey: "44444444-4444-4444-8444-444444444444", status: "approved", approvedAt: "2026-10-06T12:00:00.000Z",
  };
}
function candidate(patch: Record<string, unknown> = {}) {
  return {
    taskId, taskVersion: 39, taskStatus: "awaiting_merge", runId, runSucceeded: true, attemptNumber: 7, planVersion: 35,
    resultingRevision: revision, files: [file], requiredValidations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"],
    passedValidations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], selfReviewPassed: true, ...patch,
  };
}

test("merge binding is exact across task, run, attempt, plan, revision, files and hashes", () => {
  const valid = binding();
  validateMergeBinding(valid);
  verifyMergeCandidate(valid, candidate());
  for (const patch of [
    { runId: randomUUID() }, { taskVersion: 38 }, { planVersion: 34 }, { resultingRevision: "5".repeat(40) },
    { files: [{ ...file, path: "docs/other.md" }] }, { files: [{ ...file, afterSha256: "a".repeat(64) }] },
    { taskStatus: "blocked" }, { runSucceeded: false }, { selfReviewPassed: false },
    { passedValidations: ["test"] },
  ]) assert.throws(() => verifyMergeCandidate(valid, candidate(patch)));
  assert.throws(() => canonicalMergeFiles([{ ...file, path: "../outside.md" }]));
  assert.throws(() => canonicalMergeFiles([file, file]));
  assert.equal(mergeApprovalFingerprint(valid), mergeApprovalFingerprint(valid));
});

test("review source and target checks reject stale hashes and allow unrelated target drift only", () => {
  const approval = binding();
  verifyMergeSource(approval, { revision, files: { [file.path]: new TextEncoder().encode(after) } });
  assert.throws(() => verifyMergeSource(approval, { revision: "5".repeat(40), files: { [file.path]: new TextEncoder().encode(after) } }));
  assert.throws(() => verifyMergeSource(approval, { revision, files: { [file.path]: new TextEncoder().encode("unreviewed") } }));
  assert.throws(() => verifyMergeSource(approval, { revision, files: { [file.path]: new TextEncoder().encode(after), "runtime.d.ts": new TextEncoder().encode("extra") } }));
  const drift = verifyTargetSnapshot(approval, { baseSha: "5".repeat(40), files: { [file.path]: new TextEncoder().encode(before) } });
  assert.equal(drift.unrelatedDrift, true);
  assert.throws(() => verifyTargetSnapshot(approval, { baseSha: "5".repeat(40), files: { [file.path]: new TextEncoder().encode("changed on main") } }));
});

test("target preimage reader hashes only approved paths at the supplied immutable commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "engineering-target-preimage-"));
  const bare = join(root, "target.git");
  const seed = join(root, "seed");
  await mkdir(seed, { recursive: true });
  const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
  try {
    git(["init", "--bare", "--initial-branch=main", bare], root);
    git(["init", "--initial-branch=main"], seed);
    git(["config", "user.name", "Target preimage test"], seed);
    git(["config", "user.email", "preimage@example.invalid"], seed);
    await mkdir(join(seed, "docs"), { recursive: true });
    await writeFile(join(seed, file.path), before);
    git(["add", "--", file.path], seed); git(["commit", "-m", "target baseline"], seed);
    git(["remote", "add", "origin", bare], seed); git(["push", "-u", "origin", "main"], seed);
    const immutableSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: seed, encoding: "utf8" }).trim();
    await writeFile(join(seed, file.path), "later target content\n");
    git(["add", "--", file.path], seed); git(["commit", "-m", "target changed"], seed); git(["push", "origin", "main"], seed);
    const hashes = await readTargetPreimagesAtSha(immutableSha, [file.path, "docs/missing.md"], bare);
    assert.deepEqual(hashes, { [file.path]: file.beforeSha256, "docs/missing.md": null });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class FakeStore implements MergeExecutorStore {
  approval = binding();
  events: MergeExecutionEvent[] = [];
  blockCode = "";
  startCount = 0;
  completeCount = 0;
  failFirstComplete = false;
  async loadApproval() { return this.approval; }
  async start() { this.startCount++; }
  async progress(event: MergeExecutionEvent) { this.events.push(event); }
  async complete(_approval: MergeApprovalRecord, commitSha: string) {
    this.completeCount++;
    if (this.failFirstComplete && this.completeCount === 1) throw new Error("simulated process interruption after remote push");
    this.approval = { ...this.approval, status: "consumed", commitSha };
  }
  async block(_approval: MergeApprovalRecord, code: string) { this.blockCode = code; this.approval = { ...this.approval, status: "blocked" }; }
}

class FakeGit implements MergeExecutorGit {
  pushCount = 0;
  commitCount = 0;
  remoteCommit: string | null = null;
  changedPaths = [file.path];
  source = { revision, files: { [file.path]: new TextEncoder().encode(after) } };
  target: { baseSha: string; files: Record<string, Uint8Array | null> } = { baseSha: "4".repeat(40), files: { [file.path]: new TextEncoder().encode(before) } };
  async findRemoteCommitForApproval() { return this.remoteCommit; }
  async readCleanTarget() { return this.target; }
  async readReviewedSource() { return this.source; }
  async applyApprovedFiles() { this.commitCount++; return { changedPaths: this.changedPaths, afterHashes: { [file.path]: sha(after) } }; }
  async validateAppliedDiff() {}
  async createCommit() { return "6".repeat(40); }
  async push(_approval: MergeApprovalRecord, sha: string) { this.pushCount++; this.remoteCommit = sha; }
  async verifyRemote(_approval: MergeApprovalRecord, sha: string) { return this.remoteCommit === sha; }
}

test("one exact file is applied, attributed workflow reaches completed and repeated execution is idempotent", async () => {
  const store = new FakeStore(), git = new FakeGit();
  const first = await executeApprovedMerge(approvalId, store, git);
  assert.equal(first.commitSha, "6".repeat(40));
  assert.equal(git.pushCount, 1);
  assert.equal(git.commitCount, 1);
  assert.equal(store.events.at(-1)?.stage, "remote_verified");
  const replay = await executeApprovedMerge(approvalId, store, git);
  assert.deepEqual(replay, { commitSha: "6".repeat(40), recoveredAfterPush: true });
  assert.equal(git.pushCount, 1);
  assert.equal(git.commitCount, 1);
});

test("crash after push recovers the attributed remote commit without another commit or push", async () => {
  const store = new FakeStore(), git = new FakeGit();
  store.failFirstComplete = true;
  await assert.rejects(executeApprovedMerge(approvalId, store, git));
  assert.equal(git.pushCount, 1);
  assert.equal(store.blockCode, "");
  const resumed = await executeApprovedMerge(approvalId, store, git);
  assert.equal(resumed.recoveredAfterPush, true);
  assert.equal(git.pushCount, 1);
  assert.equal(git.commitCount, 1);
  assert.equal(store.approval.status, "consumed");
});

test("stale target and extra files fail closed before any push", async () => {
  const staleStore = new FakeStore(), staleGit = new FakeGit();
  staleGit.target.files[file.path] = new TextEncoder().encode("new main content");
  await assert.rejects(executeApprovedMerge(approvalId, staleStore, staleGit));
  assert.equal(staleStore.blockCode, "target_changed");
  assert.equal(staleGit.pushCount, 0);
  const scopeStore = new FakeStore(), scopeGit = new FakeGit();
  scopeGit.changedPaths = [file.path, "next-env.d.ts"];
  await assert.rejects(executeApprovedMerge(approvalId, scopeStore, scopeGit));
  assert.equal(scopeStore.blockCode, "scope_mismatch");
  assert.equal(scopeGit.pushCount, 0);
});

test("implementation lifecycle cannot transition into or out of merge-only states", () => {
  assert.throws(() => assertTransition("awaiting_merge", "merging"));
  assert.throws(() => assertTransition("merging", "completed"));
  assert.throws(() => assertTransition("merging", "cancelled"));
});

test("prepared SQL revokes public and worker direct merge authority", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
    await db.exec("CREATE ROLE medimori_engineering_merge_executor");
    await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
    const privileges = await db.query<Record<string, boolean>>(`
      SELECT has_function_privilege('medimori_engineering_worker','engineering_merge_start(uuid)','EXECUTE') AS worker_start,
        has_function_privilege('medimori_engineering_worker','engineering_merge_read_approval(uuid)','EXECUTE') AS worker_read,
        has_function_privilege('public','engineering_merge_start(uuid)','EXECUTE') AS public_start,
        has_function_privilege('public','engineering_merge_progress(uuid,text,text,text,text)','EXECUTE') AS public_progress,
        has_function_privilege('public','engineering_merge_complete(uuid,text)','EXECUTE') AS public_complete,
        has_function_privilege('public','engineering_create_merge_decision(uuid,integer,uuid,integer,integer,text,jsonb,text,text,text,text,uuid,text)','EXECUTE') AS public_decision,
        has_function_privilege('medimori_engineering_worker','engineering_run_lineage_valid(uuid)','EXECUTE') AS worker_lineage_helper,
        has_function_privilege('public','engineering_run_lineage_valid(uuid)','EXECUTE') AS public_lineage_helper,
        has_table_privilege('medimori_engineering_worker','engineering_tasks','UPDATE') AS worker_task_update,
        has_table_privilege('medimori_engineering_worker','engineering_run_lineage','SELECT') AS worker_lineage_read,
        has_table_privilege('medimori_engineering_worker','engineering_plan_lineage','SELECT') AS worker_plan_lineage_read,
        has_table_privilege('medimori_engineering_merge_executor','engineering_tasks','UPDATE') AS executor_task_update,
        has_table_privilege('medimori_engineering_merge_executor','engineering_approvals','UPDATE') AS executor_approval_update,
        has_function_privilege('medimori_engineering_merge_executor','engineering_create_merge_decision(uuid,integer,uuid,integer,integer,text,jsonb,text,text,text,text,uuid,text)','EXECUTE') AS executor_human_approval
    `);
    assert.deepEqual(privileges.rows[0], { worker_start: false, worker_read: false, public_start: false, public_progress: false, public_complete: false, public_decision: false,
      worker_lineage_helper: false, public_lineage_helper: false, worker_task_update: false, worker_lineage_read: false, worker_plan_lineage_read: false,
      executor_task_update: false, executor_approval_update: false, executor_human_approval: false });
    const statuses = await db.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='engineering_tasks'::regclass AND conname='engineering_tasks_status_check'`);
    assert.match(statuses.rows[0].definition, /merging/);
    assert.match(statuses.rows[0].definition, /completed/);
    const secure = await db.query<{ proname: string; security_definer: boolean; config: string[] }>(`SELECT p.proname,p.prosecdef AS security_definer,p.proconfig AS config FROM pg_proc p WHERE p.proname IN ('engineering_run_lineage_valid','engineering_merge_read_approval','engineering_create_merge_decision','engineering_merge_start','engineering_merge_progress','engineering_merge_complete')`);
    assert.equal(secure.rows.length, 6);
    for (const functionInfo of secure.rows) {
      assert.equal(functionInfo.security_definer, true, functionInfo.proname);
      assert.deepEqual(functionInfo.config, ["search_path=public, pg_temp"], functionInfo.proname);
    }
  } finally { await db.close(); }
});

test("merge decision binds durable M2D evidence and same-key replay creates one audit record", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
    await db.exec("CREATE ROLE medimori_engineering_merge_executor");
    await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
    const plan = { summary: "Reviewed documentation change", files: [file.path], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] };
    await db.query("INSERT INTO engineering_tasks(id,request,status,plan,version,created_by) VALUES($1,'fixture','awaiting_merge',$2::jsonb,39,'fixture')", [taskId, JSON.stringify(plan)]);
    const previousRunId = "55555555-5555-4555-8555-555555555555";
    const preparationKey = "66666666-6666-4666-8666-666666666666";
    const targetBaseSha = "4".repeat(40);
    await db.query("INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,started_at,finished_at,disposition,worker_revision) VALUES($1,$2,34,true,6,$3::jsonb,now()-interval '2 minutes',now()-interval '1 minute','blocked',$4)", [previousRunId, taskId, JSON.stringify(plan), revision]);
    await db.query("INSERT INTO engineering_attempt_preparations(idempotency_key,task_id,previous_run_id,actor,from_version,to_version,previous_attempt_number,previous_disposition,previous_plan,previous_risk,target_repository,target_branch,target_base_sha) VALUES($1,$2,$3,'human-reviewer',37,38,6,'blocked',$4::jsonb,'low','omarimckie/MediMori','main',$5)", [preparationKey, taskId, previousRunId, JSON.stringify(plan), targetBaseSha]);
    await db.query("INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,started_at,finished_at,disposition,worker_revision) VALUES($1,$2,35,true,7,$3::jsonb,now()-interval '1 minute',now(),'succeeded',$4)", [runId, taskId, JSON.stringify(plan), revision]);
    await db.query("INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha) VALUES($1,35,'omarimckie/MediMori','main',$2)", [taskId, targetBaseSha]);
    await db.query("INSERT INTO engineering_run_lineage(run_id,task_id,attempt_number,plan_version,target_repository,target_branch,target_base_sha,previous_run_id,preparation_key) VALUES($1,$2,7,35,'omarimckie/MediMori','main',$3,$4,$5)", [runId, taskId, targetBaseSha, previousRunId, preparationKey]);
    await db.query("INSERT INTO engineering_approvals(id,task_id,plan_version,gate,decision,actor) VALUES($1,$2,35,'plan','approved','human-reviewer')", [randomUUID(), taskId]);
    for (const command of plan.validations) await db.query("INSERT INTO engineering_validations(id,run_id,command,outcome,revision,summary,cycle) VALUES($1,$2,$3,'passed',$4,'passed',0)", [randomUUID(), runId, command, revision]);
    await db.query("INSERT INTO engineering_worker_calls(run_id,call_key,request_hash,model,reserved_tokens,reserved_micros,state,rate_snapshot,processing_state) VALUES($1,'review:0','a','gpt-6-luna',100,1,'settled','{}'::jsonb,'review_validated')", [runId]);
    const evidence = { schemaVersion: 1, approvedPaths: [file.path], replacementCount: 1,
      files: [{ path: file.path, beforeSha256: file.beforeSha256, afterSha256: file.afterSha256, beforeBytes: before.length, afterBytes: after.length, removedLines: 1, addedLines: 1 }],
      replacements: [{ path: file.path, expectedSha256: "a".repeat(64), replacementSha256: "b".repeat(64), changeSha256: "c".repeat(64) }], workspaceRevision: revision };
    await db.query("INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES($1,$2,'worker','proposal_evidence',$3::jsonb)", [randomUUID(), taskId, JSON.stringify({ runId, proposalEvidence: evidence })]);
    const files = JSON.stringify([{ path: file.path, beforeSha256: file.beforeSha256, afterSha256: file.afterSha256 }]);
    const key = "44444444-4444-4444-8444-444444444444";
    const decide = (pRun = runId, pPlan = 35, pRevision = revision, pFiles = files, pTaskVersion = 39, pKey = key) => db.query<{ result: Record<string, unknown> }>(
      "SELECT engineering_create_merge_decision($1::uuid,$2,$3::uuid,7,$4,$5,$6::jsonb,'omarimckie/MediMori','main',$7,'human-reviewer',$8::uuid,'approved') AS result",
      [taskId, pTaskVersion, pRun, pPlan, pRevision, pFiles, "4".repeat(40), pKey]);
    const first = await decide();
    const replay = await decide();
    assert.deepEqual(replay.rows[0].result, { ok: true, replayed: true, approvalId: first.rows[0].result.approvalId, status: "approved" });
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::integer AS n FROM engineering_merge_approvals")).rows[0].n, 1);
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::integer AS n FROM engineering_events WHERE action='merge_approval_created'")).rows[0].n, 1);
    await assert.rejects(decide(randomUUID()));
    await assert.rejects(decide(runId, 34));
    await assert.rejects(decide(runId, 35, "5".repeat(40)));
    await assert.rejects(decide(runId, 35, revision, JSON.stringify([{ path: file.path, beforeSha256: "d".repeat(64), afterSha256: file.afterSha256 }])));
    await assert.rejects(decide(runId, 35, revision, files, 38));
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::integer AS n FROM engineering_merge_approvals")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("merge approval requires exact immutable target preimages and records nothing on missing or changed content", async () => {
  const db = new PGlite();
  const oldEnv = {
    enabled: process.env.ENGINEERING_CONTROL_PLANE_ENABLED,
    merge: process.env.ENGINEERING_MERGE_ENABLED,
    repository: process.env.ENGINEERING_MERGE_TARGET_REPOSITORY,
    branch: process.env.ENGINEERING_MERGE_TARGET_BRANCH,
  };
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_MERGE_ENABLED = "true";
  process.env.ENGINEERING_MERGE_TARGET_REPOSITORY = "omarimckie/MediMori";
  process.env.ENGINEERING_MERGE_TARGET_BRANCH = "main";
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as unknown as ReturnType<typeof getSql>;
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
    await db.exec("CREATE ROLE medimori_engineering_merge_executor");
    await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
    const plan = { summary: "Reviewed documentation change", files: [file.path], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] };
    const targetSha = "4".repeat(40);
    await db.query("INSERT INTO engineering_tasks(id,request,status,plan,version,created_by) VALUES($1,'fixture','awaiting_merge',$2::jsonb,39,'fixture')", [taskId, JSON.stringify(plan)]);
    await db.query("INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,started_at,finished_at,disposition,worker_revision) VALUES($1,$2,35,true,1,$3::jsonb,now()-interval '1 minute',now(),'succeeded',$4)", [runId, taskId, JSON.stringify(plan), revision]);
    await db.query("INSERT INTO engineering_approvals(id,task_id,plan_version,gate,decision,actor) VALUES($1,$2,35,'plan','approved','human-reviewer')", [randomUUID(), taskId]);
    await db.query("INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha) VALUES($1,35,'omarimckie/MediMori','main',$2)", [taskId, targetSha]);
    await db.query("INSERT INTO engineering_run_lineage(run_id,task_id,attempt_number,plan_version,target_repository,target_branch,target_base_sha) VALUES($1,$2,1,35,'omarimckie/MediMori','main',$3)", [runId, taskId, targetSha]);
    for (const command of plan.validations) await db.query("INSERT INTO engineering_validations(id,run_id,command,outcome,revision,summary,cycle) VALUES($1,$2,$3,'passed',$4,'passed',0)", [randomUUID(), runId, command, revision]);
    await db.query("INSERT INTO engineering_worker_calls(run_id,call_key,request_hash,model,reserved_tokens,reserved_micros,state,rate_snapshot,processing_state) VALUES($1,'review:0','a','gpt-6-luna',100,1,'settled','{}'::jsonb,'review_validated')", [runId]);
    const evidence = { schemaVersion: 1, approvedPaths: [file.path], replacementCount: 1,
      files: [{ path: file.path, beforeSha256: file.beforeSha256, afterSha256: file.afterSha256, beforeBytes: before.length, afterBytes: after.length, removedLines: 1, addedLines: 1 }],
      replacements: [{ path: file.path, expectedSha256: sha("expected"), replacementSha256: sha("replacement"), changeSha256: sha("change") }], workspaceRevision: revision };
    await db.query("INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES($1,$2,'worker','proposal_evidence',$3::jsonb)", [randomUUID(), taskId, JSON.stringify({ runId, proposalEvidence: evidence })]);

    const readBase = async () => targetSha;
    const key = "77777777-7777-4777-8777-777777777777";
    for (const bad of [null, sha("different")]) {
      await assert.rejects(recordMergeDecision(taskId,39,"approved",targetSha,key,"human-reviewer",sql,readBase,async()=>({[file.path]:bad})),/missing or changed/);
      assert.equal((await db.query("SELECT id FROM engineering_merge_approvals")).rows.length,0);
    }
    const approved = await recordMergeDecision(taskId,39,"approved",targetSha,key,"human-reviewer",sql,readBase,async()=>({[file.path]:file.beforeSha256}));
    assert.equal(approved.status,"approved");
    assert.equal((await db.query("SELECT id FROM engineering_merge_approvals")).rows.length,1);
  } finally {
    await db.close();
    if(oldEnv.enabled===undefined) delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; else process.env.ENGINEERING_CONTROL_PLANE_ENABLED=oldEnv.enabled;
    if(oldEnv.merge===undefined) delete process.env.ENGINEERING_MERGE_ENABLED; else process.env.ENGINEERING_MERGE_ENABLED=oldEnv.merge;
    if(oldEnv.repository===undefined) delete process.env.ENGINEERING_MERGE_TARGET_REPOSITORY; else process.env.ENGINEERING_MERGE_TARGET_REPOSITORY=oldEnv.repository;
    if(oldEnv.branch===undefined) delete process.env.ENGINEERING_MERGE_TARGET_BRANCH; else process.env.ENGINEERING_MERGE_TARGET_BRANCH=oldEnv.branch;
  }
});

test("clean target executor applies only reviewed content using a temporary local bare remote", async () => {
  const temp = await mkdtemp(join(tmpdir(), "m2d-local-remote-"));
  const bare = join(temp, "origin.git"), seed = join(temp, "seed"), scratch = join(temp, "scratch"), mergeScratch = join(scratch, "merge"), exportsRoot = join(scratch, "exports");
  await mkdir(seed, { recursive: true }); await mkdir(mergeScratch, { recursive: true }); await mkdir(exportsRoot, { recursive: true });
  const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
  const oldEnv = { scratch: process.env.ENGINEERING_SCRATCH_ROOT, mergeScratch: process.env.ENGINEERING_MERGE_SCRATCH_ROOT, source: process.env.ENGINEERING_WORKSPACE_SOURCE, exports: process.env.ENGINEERING_WORKSPACE_EXPORT, review: process.env.ENGINEERING_MERGE_REVIEW_ROOT };
  try {
    git(["init", "--bare", "--initial-branch=main", bare], temp);
    git(["init", "--initial-branch=main"], seed);
    git(["config", "user.name", "M2D local test"], seed); git(["config", "user.email", "m2d-test@example.invalid"], seed);
    await mkdir(join(seed, "docs"), { recursive: true }); await writeFile(join(seed, file.path), before);
    git(["add", "--", file.path], seed); git(["commit", "-m", "test baseline"], seed);
    const targetBaseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: seed, encoding: "utf8" }).trim();
    git(["remote", "add", "origin", bare], seed); git(["push", "-u", "origin", "main"], seed);
    const exportDir = join(exportsRoot, "medimori-worker-export-fixture"); await mkdir(join(exportDir, "docs"), { recursive: true });
    await writeFile(join(exportDir, file.path), after);
    const resultRevision = createHash("sha1").update(JSON.stringify([[file.path, sha(after)]])).digest("hex");
    process.env.ENGINEERING_SCRATCH_ROOT = scratch; process.env.ENGINEERING_MERGE_SCRATCH_ROOT = mergeScratch; process.env.ENGINEERING_WORKSPACE_SOURCE = seed;
    process.env.ENGINEERING_WORKSPACE_EXPORT = exportsRoot; process.env.ENGINEERING_MERGE_REVIEW_ROOT = exportsRoot;
    const approval = { ...binding(), targetBaseSha, resultingRevision: resultRevision };
    const store = new FakeStore(); store.approval = approval;
    const adapter = new IsolatedMergeGitAdapter({ repositoryUrl: bare });
    const result = await executeApprovedMerge(approvalId, store, adapter);
    assert.match(result.commitSha, /^[a-f0-9]{40}$/);
    assert.equal(store.approval.status, "consumed");
    const remoteHead = execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: bare, encoding: "utf8" }).trim();
    assert.equal(remoteHead, result.commitSha);
    const changed = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", remoteHead + "^", remoteHead], { cwd: bare, encoding: "utf8" }).trim().split(/\r?\n/);
    assert.deepEqual(changed, [file.path]);
    assert.equal(execFileSync("git", ["show", remoteHead + ":" + file.path], { cwd: bare, encoding: "utf8" }), after);
    await adapter.dispose();
  } finally {
    if (oldEnv.scratch === undefined) delete process.env.ENGINEERING_SCRATCH_ROOT; else process.env.ENGINEERING_SCRATCH_ROOT = oldEnv.scratch;
    if (oldEnv.mergeScratch === undefined) delete process.env.ENGINEERING_MERGE_SCRATCH_ROOT; else process.env.ENGINEERING_MERGE_SCRATCH_ROOT = oldEnv.mergeScratch;
    if (oldEnv.source === undefined) delete process.env.ENGINEERING_WORKSPACE_SOURCE; else process.env.ENGINEERING_WORKSPACE_SOURCE = oldEnv.source;
    if (oldEnv.exports === undefined) delete process.env.ENGINEERING_WORKSPACE_EXPORT; else process.env.ENGINEERING_WORKSPACE_EXPORT = oldEnv.exports;
    if (oldEnv.review === undefined) delete process.env.ENGINEERING_MERGE_REVIEW_ROOT; else process.env.ENGINEERING_MERGE_REVIEW_ROOT = oldEnv.review;
    await rm(temp, { recursive: true, force: true });
  }
});
