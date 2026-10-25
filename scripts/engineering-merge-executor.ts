import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { configuredMergeTarget } from "../src/lib/engineering/merge-policy";
import { executeApprovedMerge, type MergeExecutorStore } from "../src/lib/engineering/merge-executor";
import { IsolatedMergeGitAdapter } from "../src/lib/engineering/merge-git-adapter";
import type { MergeApprovalRecord, MergeExecutionEvent } from "../src/lib/engineering/merge-protocol";
import { restrictedWorkerDatabaseTarget } from "../src/lib/engineering/worker-initialization";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hex40 = /^[a-f0-9]{40}$/;
const safeCodes = new Set(["target_changed", "source_revision_mismatch", "file_hash_mismatch", "scope_mismatch", "validation_failed", "git_operation_failed", "remote_verification_failed", "approval_invalid", "executor_configuration_invalid"]);

function failure(code: string): never { throw new Error(safeCodes.has(code) ? code : "merge_execution_failed"); }

function configuredDatabase() {
  configuredMergeTarget();
  const expectedBranchId = process.env.ENGINEERING_MERGE_DATABASE_BRANCH_ID?.trim();
  const url = process.env.ENGINEERING_MERGE_DATABASE_URL?.trim();
  let parsed: URL;
  try { parsed = new URL(url ?? ""); } catch { failure("executor_configuration_invalid"); }
  let username = parsed!.username;
  try { username = decodeURIComponent(username); } catch { failure("executor_configuration_invalid"); }
  if (!url || !expectedBranchId || expectedBranchId !== "br-little-art-au7ke21s" ||
    !["postgres:", "postgresql:"].includes(parsed!.protocol) || parsed!.hostname !== restrictedWorkerDatabaseTarget.host ||
    parsed!.pathname !== "/" + restrictedWorkerDatabaseTarget.database || username !== "medimori_engineering_merge_executor" || !parsed!.password) failure("executor_configuration_invalid");
  return neon(url);
}

async function verifyDatabaseIdentity(sql: NeonQueryFunction<false, false>) {
  const rows = await sql`
    SELECT current_user AS current_user,session_user AS session_user,current_database() AS database_name,
      r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      NOT (
        has_table_privilege(session_user,'engineering_tasks','SELECT') OR has_table_privilege(session_user,'engineering_tasks','INSERT') OR has_table_privilege(session_user,'engineering_tasks','UPDATE') OR has_table_privilege(session_user,'engineering_tasks','DELETE') OR has_table_privilege(session_user,'engineering_tasks','TRUNCATE') OR
        has_table_privilege(session_user,'engineering_runs','SELECT') OR has_table_privilege(session_user,'engineering_runs','INSERT') OR has_table_privilege(session_user,'engineering_runs','UPDATE') OR has_table_privilege(session_user,'engineering_runs','DELETE') OR has_table_privilege(session_user,'engineering_runs','TRUNCATE') OR
        has_table_privilege(session_user,'engineering_approvals','SELECT') OR has_table_privilege(session_user,'engineering_approvals','INSERT') OR has_table_privilege(session_user,'engineering_approvals','UPDATE') OR has_table_privilege(session_user,'engineering_approvals','DELETE') OR has_table_privilege(session_user,'engineering_approvals','TRUNCATE') OR
        has_table_privilege(session_user,'engineering_costs','SELECT') OR has_table_privilege(session_user,'engineering_costs','INSERT') OR has_table_privilege(session_user,'engineering_costs','UPDATE') OR has_table_privilege(session_user,'engineering_costs','DELETE') OR has_table_privilege(session_user,'engineering_costs','TRUNCATE') OR
        has_table_privilege(session_user,'engineering_events','SELECT') OR has_table_privilege(session_user,'engineering_events','INSERT') OR has_table_privilege(session_user,'engineering_events','UPDATE') OR has_table_privilege(session_user,'engineering_events','DELETE') OR has_table_privilege(session_user,'engineering_events','TRUNCATE') OR
        has_table_privilege(session_user,'engineering_merge_approvals','SELECT') OR has_table_privilege(session_user,'engineering_merge_approvals','INSERT') OR has_table_privilege(session_user,'engineering_merge_approvals','UPDATE') OR has_table_privilege(session_user,'engineering_merge_approvals','DELETE') OR has_table_privilege(session_user,'engineering_merge_approvals','TRUNCATE') OR
        has_table_privilege(session_user,'engineering_merge_executions','SELECT') OR has_table_privilege(session_user,'engineering_merge_executions','INSERT') OR has_table_privilege(session_user,'engineering_merge_executions','UPDATE') OR has_table_privilege(session_user,'engineering_merge_executions','DELETE') OR has_table_privilege(session_user,'engineering_merge_executions','TRUNCATE')
      ) AS no_direct_table_access,
      has_function_privilege(session_user,'engineering_merge_read_approval(uuid)','EXECUTE') AS can_read_approval,
      has_function_privilege(session_user,'engineering_worker(uuid,text,text,integer,jsonb)','EXECUTE') AS can_invoke_worker
    FROM pg_roles r WHERE r.rolname=session_user
  `;
  const identity = rows[0] as Record<string, unknown> | undefined;
  if (!identity || identity.current_user !== "medimori_engineering_merge_executor" || identity.session_user !== "medimori_engineering_merge_executor" ||
    identity.database_name !== "neondb" || identity.rolsuper !== false || identity.rolcreatedb !== false || identity.rolcreaterole !== false ||
    identity.rolreplication !== false || identity.rolbypassrls !== false ||
    identity.no_direct_table_access !== true || identity.can_read_approval !== true || identity.can_invoke_worker !== false) failure("executor_configuration_invalid");
}

function parseApproval(raw: unknown): MergeApprovalRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return failure("approval_invalid");
  const value = raw as Record<string, unknown>;
  const target = value.target as Record<string, unknown> | null;
  if (!target || !Array.isArray(value.files) || !["approved", "consumed"].includes(String(value.status))) return failure("approval_invalid");
  return {
    id: String(value.id), taskId: String(value.taskId), taskVersion: Number(value.taskVersion), runId: String(value.runId), attemptNumber: Number(value.attemptNumber),
    planVersion: Number(value.planVersion), resultingRevision: String(value.resultingRevision),
    files: value.files as MergeApprovalRecord["files"],
    target: { repository: String(target.repository), branch: String(target.branch), remote: String(target.remote) },
    targetBaseSha: String(value.targetBaseSha), actor: String(value.actor), idempotencyKey: String(value.idempotencyKey),
    status: value.status as MergeApprovalRecord["status"], approvedAt: String(value.approvedAt),
    commitSha: typeof value.commitSha === "string" ? value.commitSha : null,
  };
}

async function run(approvalId: string) {
  if (!uuid.test(approvalId)) failure("approval_invalid");
  if (["DATABASE_URL", "ENGINEERING_WORKER_DATABASE_URL", "OPENAI_API_KEY", "ADMIN_USERS", "ADMIN_SESSION_SECRET", "GITHUB_TOKEN", "GH_TOKEN"].some(name => Boolean(process.env[name]))) failure("executor_configuration_invalid");
  const sql = configuredDatabase();
  await verifyDatabaseIdentity(sql);
  const store: MergeExecutorStore = {
    async loadApproval(id) {
      const rows = await sql`SELECT engineering_merge_read_approval(${id}::uuid) AS approval`;
      return rows[0] ? parseApproval(rows[0].approval) : null;
    },
    async start(approval) {
      const rows = await sql`SELECT engineering_merge_start(${approval.id}::uuid) AS result`;
      if (!(rows[0]?.result as Record<string, unknown> | undefined)?.ok) failure("approval_invalid");
    },
    async progress(event: MergeExecutionEvent) {
      const state = event.stage;
      if (!["target_verified", "diff_verified", "commit_created", "push_attempted", "pushed", "remote_verified"].includes(state)) failure("git_operation_failed");
      const rows = await sql`SELECT engineering_merge_progress(${event.approvalId}::uuid,${state},${event.baseSha ?? null},${event.commitSha ?? null},NULL) AS result`;
      if (!(rows[0]?.result as Record<string, unknown> | undefined)?.ok) failure("git_operation_failed");
    },
    async complete(approval, commitSha) {
      if (!hex40.test(commitSha)) failure("remote_verification_failed");
      const rows = await sql`SELECT engineering_merge_complete(${approval.id}::uuid,${commitSha}) AS result`;
      if (!(rows[0]?.result as Record<string, unknown> | undefined)?.ok) failure("remote_verification_failed");
    },
    async block(approval, code) {
      const safe = safeCodes.has(code) ? code : "git_operation_failed";
      const rows = await sql`SELECT engineering_merge_progress(${approval.id}::uuid,'blocked',NULL,NULL,${safe}) AS result`;
      if (!(rows[0]?.result as Record<string, unknown> | undefined)?.ok) failure("git_operation_failed");
    },
  };
  const git = new IsolatedMergeGitAdapter();
  try {
    const result = await executeApprovedMerge(approvalId, store, git);
    process.stdout.write(JSON.stringify({ ok: true, commitSha: result.commitSha, recoveredAfterPush: result.recoveredAfterPush }) + "\n");
  } finally {
    await git.dispose();
  }
}

const approvalId = process.argv[2];
if (!approvalId) {
  process.stderr.write("A durable merge approval ID is required.\n");
  process.exitCode = 2;
} else {
  run(approvalId).catch(error => {
    const code = error instanceof Error && safeCodes.has(error.message) ? error.message : "merge_execution_failed";
    process.stderr.write("Engineering merge stopped safely: " + code + ".\n");
    process.exitCode = 1;
  });
}
