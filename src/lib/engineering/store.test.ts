import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { getSql } from "@/lib/db";
import { validationCommands } from "./policy";
import { actOnTask as storeActOnTask, approvePreparedAttempt, authorizePreparedExecution as storeAuthorizePreparedExecution, createTask, listTasks, prepareFreshAttempt as storePrepareFreshAttempt, prepareInitialAttempt as storePrepareInitialAttempt, prepareRetryAttemptSubject as storePrepareRetryAttemptSubject, supersedeStalePreparedAttempt, recordRunEvidence, taskHistory } from "./store";

const testTargetSha = "c".repeat(40);
const testSourceRevision = async () => "e".repeat(40);
const readTestTargetSha = async () => testTargetSha;
const readTestPreimages = async (_sha: string, paths: readonly string[]) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)]));
const actOnTask = (id: string, version: number, action: string, value: unknown, actor: string, database: ReturnType<typeof getSql>) => storeActOnTask(id,version,action,value,actor,database);
type PreparedSubjectResult = { attemptId: string; attemptNumber: number; planVersion: number; targetRepository?: string; targetBranch?: string; targetBaseSha?: string; implementationSourceRevision?: string; replayed?: boolean; ok?: boolean };
const prepareInitialSubject = (...args: Parameters<typeof storePrepareInitialAttempt>) => storePrepareInitialAttempt(...args) as Promise<PreparedSubjectResult>;
async function authorizePreparedExecution(...args: Parameters<typeof storeAuthorizePreparedExecution>) {
  const previous = process.env.ENGINEERING_WORKER_ENABLED;
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  try { return await storeAuthorizePreparedExecution(...args); }
  finally { if (previous === undefined) delete process.env.ENGINEERING_WORKER_ENABLED; else process.env.ENGINEERING_WORKER_ENABLED = previous; }
}
const prepareFreshAttempt = (id: string, version: number, key: string, actor: string, database: ReturnType<typeof getSql>) => storePrepareFreshAttempt(id,version,key,actor,database,readTestTargetSha);
const prepareInitialAttempt = async (id: string, version: number, actor: string, database: ReturnType<typeof getSql>) => {
  await prepareInitialSubject(id,version,randomUUID(),actor,database,readTestTargetSha,readTestPreimages,testSourceRevision);
  return (await taskHistory(id,database)).task!;
};
const prepareRetryAttemptSubject = (id: string, version: number, key: string, actor: string, database: ReturnType<typeof getSql>, sourceReader = testSourceRevision) => storePrepareRetryAttemptSubject(id,version,key,actor,database,readTestTargetSha,readTestPreimages,sourceReader) as Promise<PreparedSubjectResult & { replayed: boolean }>;

async function createTestSql() {
  const db = new PGlite();
  await db.exec("CREATE ROLE medimori_engineering_merge_executor");
  await db.exec("CREATE ROLE medimori_engineering_2c_worker");
  await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-initial-attempt-preparation.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-source-binding.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-source-selection-policy.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-approval-execution-separation.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-prepared-subject-supersession.sql", import.meta.url), "utf8"));
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as unknown as ReturnType<typeof getSql>;
  return { db, sql };
}

async function approveAndAuthorize(id: string, taskVersion: number, actor: string, database: ReturnType<typeof getSql>, workerEnabled = true) {
  const subject = (await database`SELECT attempt_id FROM engineering_prepared_attempts WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 1`)[0] as { attempt_id: string } | undefined;
  assert.ok(subject, "prepared subject exists");
  await approvePreparedAttempt(id, taskVersion, subject.attempt_id, actor, database, readTestTargetSha, readTestPreimages, testSourceRevision);
  await authorizePreparedExecution(id, taskVersion, subject.attempt_id, actor, database, readTestTargetSha, readTestPreimages, testSourceRevision);
  if (!workerEnabled) await database`UPDATE engineering_runs SET worker_enabled=false WHERE id=${subject.attempt_id}::uuid`;
  return (await taskHistory(id, database)).task!;
}

test("approval records the exact P+T+S subject without a run; separate authorization creates one source-bound run", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const plan = { summary: "Clarify README source path", files: ["README.md"], validations: [...validationCommands], operations: [] };
    let task = await createTask("README-only proof", "owner", randomUUID(), sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", plan, "owner", sql);
    const planVersion = task.version;
    const prepared = await prepareInitialSubject(task.id, task.version, randomUUID(), "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision);
    const attemptId = String(prepared.attemptId);
    await assert.rejects(authorizePreparedExecution(task.id, planVersion, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /required approval\/execution state/);
    await assert.rejects(storeActOnTask(task.id, task.version, "approve", null, "owner", sql), /separate actions/);
    await assert.rejects(storeActOnTask(task.id, task.version, "transition", "implementing", "owner", sql), /Unsupported transition/);
    await assert.rejects(approvePreparedAttempt(task.id, planVersion, attemptId, "worker:forged", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /authenticated human identity/);
    await assert.rejects(approvePreparedAttempt(task.id, planVersion, randomUUID(), "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /immutable plan, target, and source subject/);

    const approvals = await Promise.allSettled([
      approvePreparedAttempt(task.id, planVersion, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
      approvePreparedAttempt(task.id, planVersion, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
    ]);
    assert.equal(approvals.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(approvals.filter(result => result.status === "rejected").length, 1);
    task = (await taskHistory(task.id, sql)).task!;
    assert.equal(task.status, "awaiting_execution");
    assert.equal(task.version, planVersion);
    const approval = (await sql`SELECT task_id,plan_version,prepared_attempt_id,gate,decision,actor FROM engineering_approvals WHERE task_id=${task.id}::uuid`)[0];
    assert.deepEqual(approval, { task_id: task.id, plan_version: planVersion, prepared_attempt_id: attemptId, gate: "plan", decision: "approved", actor: "owner" });
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_run_lineage WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_costs`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_worker_calls`).length, 0);
    const approvalEvent = (await sql`SELECT action,details FROM engineering_events WHERE task_id=${task.id}::uuid AND action='plan_approval_created'`)[0] as { action: string; details: Record<string, unknown> };
    assert.equal(approvalEvent.details.preparedAttemptId, attemptId);
    assert.equal(approvalEvent.details.planVersion, planVersion);
    const lineagePrivileges = (await sql`SELECT
      has_function_privilege('medimori_engineering_worker','engineering_run_lineage_valid(uuid)','EXECUTE') AS worker_group,
      has_function_privilege('medimori_engineering_2c_worker','engineering_run_lineage_valid(uuid)','EXECUTE') AS worker_login,
      has_function_privilege('medimori_engineering_merge_executor','engineering_run_lineage_valid(uuid)','EXECUTE') AS merge_executor,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='engineering_run_lineage_valid(uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public,
      EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='engineering_run_lineage_valid(uuid)'::regprocedure AND p.prosecdef AND 'search_path=public, pg_temp'=ANY(p.proconfig)) AS secure_definer`)[0];
    assert.deepEqual(lineagePrivileges, { worker_group: false, worker_login: false, merge_executor: false, public: false, secure_definer: true });

    process.env.ENGINEERING_WORKER_ENABLED = "false";
    await assert.rejects(storeAuthorizePreparedExecution(task.id, task.version, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /Worker execution is not enabled/);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0, "disabled worker cannot receive a run");
    process.env.ENGINEERING_WORKER_ENABLED = "true";

    await assert.rejects(authorizePreparedExecution(task.id, task.version, attemptId, "owner", sql, async () => "f".repeat(40), readTestPreimages, testSourceRevision), /target branch changed/);
    await assert.rejects(authorizePreparedExecution(task.id, task.version, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, async () => "f".repeat(40)), /implementation source changed/);
    await sql`UPDATE engineering_tasks SET plan=${JSON.stringify({ ...plan, summary: "stale P" })}::jsonb WHERE id=${task.id}::uuid`;
    await assert.rejects(authorizePreparedExecution(task.id, task.version, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /immutable plan, target, and source subject/);
    await sql`UPDATE engineering_tasks SET plan=${JSON.stringify(plan)}::jsonb WHERE id=${task.id}::uuid`;

    const executions = await Promise.allSettled([
      authorizePreparedExecution(task.id, task.version, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
      authorizePreparedExecution(task.id, task.version, attemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
    ]);
    assert.equal(executions.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(executions.filter(result => result.status === "rejected").length, 1);
    task = (await taskHistory(task.id, sql)).task!;
    assert.equal(task.status, "implementing");
    assert.equal(task.version, planVersion + 1);
    const run = (await sql`SELECT id,task_id,plan_version,attempt_number,worker_enabled FROM engineering_runs WHERE task_id=${task.id}::uuid`)[0];
    assert.deepEqual(run, { id: attemptId, task_id: task.id, plan_version: planVersion, attempt_number: 1, worker_enabled: true });
    const lineage = (await sql`SELECT run_id,task_id,attempt_number,plan_version,implementation_source_revision,source_binding_version,source_selection_policy_version FROM engineering_run_lineage WHERE run_id=${attemptId}::uuid`)[0];
    assert.deepEqual(lineage, { run_id: attemptId, task_id: task.id, attempt_number: 1, plan_version: planVersion, implementation_source_revision: "e".repeat(40), source_binding_version: 1, source_selection_policy_version: 2 });
    assert.equal((await sql`SELECT engineering_run_lineage_valid(${attemptId}::uuid) AS valid`)[0].valid, true);
    await sql`UPDATE engineering_approvals SET prepared_attempt_id=NULL WHERE task_id=${task.id}::uuid AND prepared_attempt_id=${attemptId}::uuid`;
    assert.equal((await sql`SELECT engineering_run_lineage_valid(${attemptId}::uuid) AS valid`)[0].valid, false, "policy-v2 lineage requires approval bound to the exact prepared subject");
    await sql`UPDATE engineering_approvals SET prepared_attempt_id=${attemptId}::uuid WHERE task_id=${task.id}::uuid AND plan_version=${planVersion} AND gate='plan'`;
    assert.equal((await sql`SELECT engineering_run_lineage_valid(${attemptId}::uuid) AS valid`)[0].valid, true);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_events WHERE task_id=${task.id}::uuid AND action='execution_authorized'`)[0].count, 1);
  } finally {
    await db.close();
    delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    delete process.env.ENGINEERING_WORKER_ENABLED;
  }
});

test("approval fails closed for incomplete gates, non-README scope, wrong binding, and execution without an exact subject approval", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const invalidPlans = [
      { summary: "missing gate", files: ["README.md"], validations: ["lint", "typecheck", "security:check"], operations: [] },
      { summary: "wrong scope", files: ["docs/engineering-agent.md"], validations: [...validationCommands], operations: [] },
      { summary: "protected operation", files: ["README.md"], validations: [...validationCommands], operations: ["external_publish"] },
    ];
    for (const [index, plan] of invalidPlans.entries()) {
      let task = await createTask("Rejected plan fixture", "owner", randomUUID(), sql);
      task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
      task = await actOnTask(task.id, task.version, "plan", plan, "owner", sql);
      const prepared = await prepareInitialSubject(task.id, task.version, randomUUID(), "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision);
      await assert.rejects(approvePreparedAttempt(task.id, task.version, String(prepared.attemptId), "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision));
      assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 0, `invalid plan ${index} creates no approval`);
      assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0, `invalid plan ${index} creates no run`);
    }

    let task = await createTask("Unapproved execution fixture", "owner", randomUUID(), sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "README proof", files: ["README.md"], validations: [...validationCommands], operations: [] }, "owner", sql);
    const prepared = await prepareInitialSubject(task.id, task.version, randomUUID(), "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision);
    await sql`UPDATE engineering_tasks SET status='awaiting_execution' WHERE id=${task.id}::uuid`;
    await assert.rejects(authorizePreparedExecution(task.id, task.version, String(prepared.attemptId), "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /Execution authorization was stale, unauthorized, or already consumed/);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 0);
  } finally {
    await db.close();
    delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    delete process.env.ENGINEERING_WORKER_ENABLED;
  }
});

test("task creation is idempotent per key, including concurrent replay, with one intake event", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const key = "a2222222-2222-4222-8222-222222222222";
    const [first, replay] = await Promise.all([
      createTask("Same request", "owner", key, sql),
      createTask("Same request", "owner", key, sql),
    ]);
    assert.equal(first.id, replay.id);
    const tasks = await sql`SELECT * FROM engineering_tasks WHERE creation_key=${key}::uuid`;
    const events = await sql`SELECT * FROM engineering_events WHERE task_id=${first.id}::uuid AND action='intake'`;
    assert.equal(tasks.length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].actor, "owner");
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("initial attempt is immutably target-bound before approval and same-key preparation replays", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    let task = await createTask("Initial target binding", "human", "a1234567-1234-4234-8234-123456789abc", sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "human", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "One bounded edit", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] }, "human", sql);
    const planVersion = task.version;
    const key = "a2345678-1234-4234-8234-123456789abc";
    const [prepared, replay] = await Promise.all([
      prepareInitialSubject(task.id, task.version, key, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
      prepareInitialSubject(task.id, task.version, key, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
    ]);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.planVersion, planVersion);
    assert.equal(prepared.targetRepository, "omarimckie/MediMori");
    assert.equal(prepared.targetBranch, "main");
    assert.equal(prepared.targetBaseSha, testTargetSha);
    assert.equal(prepared.replayed || replay.replayed, true);
    assert.equal(prepared.attemptId, replay.attemptId);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_costs`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_worker_calls`).length, 0);
    await assert.rejects(db.query("SELECT engineering_worker($1::uuid,'claim','synthetic-worker',0,$2::jsonb)", [prepared.attemptId, JSON.stringify({ preflightRevision: "a".repeat(40) })]));
    const persisted = (await sql`SELECT * FROM engineering_prepared_attempts WHERE task_id=${task.id}::uuid`)[0];
    assert.equal(persisted.attempt_id, prepared.attemptId);
    assert.equal(Number(persisted.plan_version), planVersion);
    assert.equal(persisted.implementation_source_revision, "e".repeat(40));
    assert.notEqual(persisted.target_base_sha, persisted.implementation_source_revision);
    await assert.rejects(prepareInitialSubject(task.id, planVersion, key, "human", sql, readTestTargetSha, readTestPreimages, async () => "f".repeat(40)), /different subject/);
    const preparationEvent = (await sql`SELECT details FROM engineering_events WHERE task_id=${task.id}::uuid AND action='prepare_initial_attempt'`)[0] as { details: Record<string,unknown> };
    assert.equal((await sql`SELECT * FROM engineering_events WHERE task_id=${task.id}::uuid AND action='prepare_initial_attempt'`).length, 1);
    assert.equal(preparationEvent.details.implementationSourceRevision, "e".repeat(40));
    await assert.rejects(sql`UPDATE engineering_prepared_attempts SET target_base_sha=${"f".repeat(40)} WHERE attempt_id=${prepared.attemptId}::uuid`);
    await assert.rejects(approvePreparedAttempt(task.id, task.version, prepared.attemptId, "human", sql, async () => "f".repeat(40), readTestPreimages, testSourceRevision), /target branch changed/);
    await assert.rejects(approvePreparedAttempt(task.id, task.version, prepared.attemptId, "human", sql, readTestTargetSha, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "f".repeat(64)])), testSourceRevision), /README preimage changed/);
    const originalPlan = task.plan;
    await sql`UPDATE engineering_tasks SET plan=${JSON.stringify({ ...originalPlan!, summary: "drifted after preparation" })}::jsonb WHERE id=${task.id}::uuid`;
    await assert.rejects(approvePreparedAttempt(task.id, task.version, prepared.attemptId, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /immutable plan, target, and source subject/);
    await sql`UPDATE engineering_tasks SET plan=${JSON.stringify(originalPlan)}::jsonb WHERE id=${task.id}::uuid`;
    const privileges = await sql`SELECT
      has_function_privilege('medimori_engineering_worker','engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text)','EXECUTE') AS worker_execute,
      has_function_privilege('medimori_engineering_merge_executor','engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text)','EXECUTE') AS merge_execute,
      has_function_privilege('medimori_engineering_2c_worker','engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text)','EXECUTE') AS retry_worker_execute,
      has_function_privilege('medimori_engineering_merge_executor','engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text)','EXECUTE') AS retry_merge_execute,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid='engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid='engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS retry_public_execute,
      has_function_privilege('medimori_engineering_2c_worker','engineering_record_source_mismatch(uuid,text)','EXECUTE') AS worker_mismatch_execute,
      has_function_privilege('medimori_engineering_merge_executor','engineering_record_source_mismatch(uuid,text)','EXECUTE') AS merge_mismatch_execute,
      has_table_privilege('medimori_engineering_worker','engineering_prepared_attempts','SELECT') AS worker_read,
      has_table_privilege('medimori_engineering_2c_worker','engineering_prepared_attempts','INSERT') AS worker_insert,
      has_table_privilege('medimori_engineering_2c_worker','engineering_prepared_attempts','UPDATE') AS worker_update,
      has_table_privilege('medimori_engineering_2c_worker','engineering_prepared_attempts','DELETE') AS worker_delete,
      has_table_privilege('medimori_engineering_merge_executor','engineering_prepared_attempts','SELECT') AS merge_read`;
    assert.deepEqual(privileges[0], { worker_execute: false, merge_execute: false, retry_worker_execute: false, retry_merge_execute: false, public_execute: false, retry_public_execute: false, worker_mismatch_execute: true, merge_mismatch_execute: false, worker_read: false, worker_insert: false, worker_update: false, worker_delete: false, merge_read: false });
    task = (await taskHistory(task.id, sql)).task!;
    assert.equal(task.status, "awaiting_approval");
    assert.equal(task.version, planVersion);
    await assert.rejects(prepareInitialSubject(task.id, task.version - 1, "a3456789-1234-4234-8234-123456789abc", "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision));
    await assert.rejects(approvePreparedAttempt(task.id, task.version, prepared.attemptId, "human", sql, readTestTargetSha, readTestPreimages, async () => "f".repeat(40)), /implementation source changed/);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    const approved = await approvePreparedAttempt(task.id, task.version, prepared.attemptId, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision);
    task = (await taskHistory(task.id, sql)).task!;
    assert.equal(approved.status, "awaiting_execution");
    assert.equal(task.version, planVersion, "approval preserves plan version");
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_run_lineage WHERE task_id=${task.id}::uuid`).length, 0);
    await assert.rejects(db.query("SELECT engineering_worker($1::uuid,'claim','synthetic-worker',0,$2::jsonb)", [prepared.attemptId, JSON.stringify({ preflightRevision: "e".repeat(40) })]));
    await assert.rejects(approvePreparedAttempt(task.id, task.version, prepared.attemptId, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision), /required approval\/execution state/);
    await authorizePreparedExecution(task.id, task.version, prepared.attemptId, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision);
    task = (await taskHistory(task.id, sql)).task!;
    const run = (await taskHistory(task.id, sql)).runs[0];
    assert.equal(run.id, prepared.attemptId);
    assert.equal(Number(run.attempt_number), 1);
    assert.equal(Number(run.plan_version), planVersion);
    const approval = (await sql`SELECT prepared_attempt_id FROM engineering_approvals WHERE task_id=${task.id}::uuid AND plan_version=${planVersion} AND decision='approved'`)[0];
    assert.deepEqual(approval, { prepared_attempt_id: prepared.attemptId });
    assert.equal(task.status, "implementing");
    const lineageCheck = await sql`SELECT engineering_run_lineage_valid(${prepared.attemptId}::uuid) AS valid`;
    assert.equal(lineageCheck[0].valid, true, "prepared first-attempt lineage must validate after approval");
    const approvedSource = (await sql`SELECT implementation_source_revision,source_binding_version,source_selection_policy_version FROM engineering_run_lineage WHERE run_id=${prepared.attemptId}::uuid`)[0];
    assert.deepEqual(approvedSource, { implementation_source_revision: "e".repeat(40), source_binding_version: 1, source_selection_policy_version: 2 });
    const claim = await db.query<{ result: Record<string, unknown> }>("SELECT engineering_worker($1::uuid,'claim','synthetic-worker',0,$2::jsonb) result", [prepared.attemptId, JSON.stringify({ preflightRevision: "e".repeat(40) })]);
    assert.equal(claim.rows[0].result.preflight_revision, "e".repeat(40));
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; delete process.env.ENGINEERING_WORKER_ENABLED; }
});

test("approval cannot create initial target lineage or a run when preparation is missing", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    let task = await createTask("Preparation must precede approval", "human", "a4567890-1234-4234-8234-123456789abc", sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "human", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "Bounded edit", files: ["docs/engineering-agent.md"], validations: ["test"], operations: [] }, "human", sql);
    task = await actOnTask(task.id, task.version, "transition", "awaiting_approval", "human", sql);
    await assert.rejects(approvePreparedAttempt(task.id, task.version, randomUUID(), "human", sql), /immutable plan, target, and source subject/);
    assert.equal((await sql`SELECT * FROM engineering_prepared_attempts WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_plan_lineage WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("different-key concurrent initial preparation creates only one logical Attempt #1", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    let task = await createTask("Concurrent source-bound preparation", "human", randomUUID(), sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "human", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "One bounded edit", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] }, "human", sql);
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(keys.map(key => prepareInitialSubject(task.id, task.version, key, "human", sql, readTestTargetSha, readTestPreimages, testSourceRevision)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal((await sql`SELECT * FROM engineering_prepared_attempts WHERE task_id=${task.id}::uuid`).length, 1);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("source-binding migrations reapply cleanly and preserve readable legacy null lineage", async () => {
  const { db, sql } = await createTestSql();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-initial-attempt-preparation.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-binding.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-selection-policy.sql", import.meta.url), "utf8"));
    const taskId = randomUUID(), runId = randomUUID(), planVersion = 4;
    const plan = { summary: "Historical task", files: ["docs/engineering-agent.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] };
    await sql`INSERT INTO engineering_tasks(id,request,status,risk,plan,version,created_by) VALUES(${taskId}::uuid,'legacy request','implementing','low',${JSON.stringify(plan)}::jsonb,${planVersion + 1},'human')`;
    await sql`INSERT INTO engineering_approvals(id,task_id,plan_version,gate,decision,actor) VALUES(${randomUUID()}::uuid,${taskId}::uuid,${planVersion},'plan','approved','human')`;
    await sql`INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,disposition) VALUES(${runId}::uuid,${taskId}::uuid,${planVersion},true,1,${JSON.stringify(plan)}::jsonb,'active')`;
    await sql`INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha) VALUES(${taskId}::uuid,${planVersion},'omarimckie/MediMori','main',${testTargetSha})`;
    await sql`INSERT INTO engineering_run_lineage(run_id,task_id,attempt_number,plan_version,target_repository,target_branch,target_base_sha) VALUES(${runId}::uuid,${taskId}::uuid,1,${planVersion},'omarimckie/MediMori','main',${testTargetSha})`;
    const legacy = (await sql`SELECT source_binding_version,implementation_source_revision,source_selection_policy_version,engineering_run_lineage_valid(${runId}::uuid) AS valid FROM engineering_run_lineage WHERE run_id=${runId}::uuid`)[0];
    assert.deepEqual(legacy, { source_binding_version: 0, implementation_source_revision: null, source_selection_policy_version: 0, valid: true });

    const oldTaskId=randomUUID(),oldRunId=randomUUID(),oldVersion=8,oldS="a".repeat(40);
    const oldRequest="historical P+T+S subject";
    await sql`INSERT INTO engineering_tasks(id,request,status,risk,plan,version,created_by) VALUES(${oldTaskId}::uuid,${oldRequest},'implementing','low',${JSON.stringify(plan)}::jsonb,${oldVersion+1},'human')`;
    await sql`INSERT INTO engineering_approvals(id,task_id,plan_version,gate,decision,actor) VALUES(${randomUUID()}::uuid,${oldTaskId}::uuid,${oldVersion},'plan','approved','human')`;
    await sql`INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,disposition) VALUES(${oldRunId}::uuid,${oldTaskId}::uuid,${oldVersion},true,1,${JSON.stringify(plan)}::jsonb,'active')`;
    await sql`INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha) VALUES(${oldTaskId}::uuid,${oldVersion},'omarimckie/MediMori','main',${testTargetSha})`;
    const prepareKey=randomUUID(),preimages={"docs/engineering-agent.md":"b".repeat(64)};
    await sql`INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,plan_version,idempotency_key,actor,request_snapshot,plan_snapshot,risk,target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision)
      VALUES(${oldRunId}::uuid,${oldTaskId}::uuid,1,${oldVersion},${prepareKey}::uuid,'human',${oldRequest},${JSON.stringify(plan)}::jsonb,'low','omarimckie/MediMori','main',${testTargetSha},${JSON.stringify(preimages)}::jsonb,${oldS})`;
    await sql`INSERT INTO engineering_run_lineage(run_id,task_id,attempt_number,plan_version,target_repository,target_branch,target_base_sha,implementation_source_revision,source_binding_version)
      VALUES(${oldRunId}::uuid,${oldTaskId}::uuid,1,${oldVersion},'omarimckie/MediMori','main',${testTargetSha},${oldS},1)`;
    const oldV1=(await sql`SELECT source_binding_version,source_selection_policy_version,engineering_run_lineage_valid(${oldRunId}::uuid) AS valid FROM engineering_run_lineage WHERE run_id=${oldRunId}::uuid`)[0];
    assert.deepEqual(oldV1,{source_binding_version:1,source_selection_policy_version:0,valid:true},"historical version-1 P+T+S remains auditable");
    await assert.rejects(db.query("SELECT engineering_worker($1::uuid,'claim','legacy-worker',0,$2::jsonb)",[oldRunId,JSON.stringify({preflightRevision:oldS})]),/approved_source_policy_or_revision_mismatch/i,"historical policy 0 cannot execute under policy 2");
  } finally { await db.close(); }
});

test("retry closure refuses a finished blocked run with unresolved provider reservation", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const plan = { summary: "One bounded edit", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] };
    let task = await createTask("Blocked run reservation guard", "human", randomUUID(), sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "human", sql);
    task = await actOnTask(task.id, task.version, "plan", plan, "human", sql);
    task = await prepareInitialAttempt(task.id, task.version, "human", sql);
    task = await approveAndAuthorize(task.id, task.version, "human", sql);
    const runId = (await sql`SELECT id FROM engineering_runs WHERE task_id=${task.id}::uuid`)[0].id as string;
    await sql`UPDATE engineering_runs SET finished_at=now(),disposition='blocked',reserved_tokens=1,reserved_micros=10 WHERE id=${runId}::uuid`;
    await sql`UPDATE engineering_tasks SET status='blocked',version=version+1 WHERE id=${task.id}::uuid`;
    const version = (await taskHistory(task.id, sql)).task!.version;
    await assert.rejects(prepareFreshAttempt(task.id, version, randomUUID(), "human", sql), /not safely closed/);
    assert.equal((await sql`SELECT * FROM engineering_attempt_preparations WHERE task_id=${task.id}::uuid`).length, 0);
    const unchanged = (await sql`SELECT reserved_tokens,reserved_micros,disposition FROM engineering_runs WHERE id=${runId}::uuid`)[0];
    assert.deepEqual(unchanged, { reserved_tokens: 1, reserved_micros: 10, disposition: "blocked" });
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; delete process.env.ENGINEERING_WORKER_ENABLED; }
});

test("different keys allow intentional identical requests; a key cannot be reused for changed content", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const one = await createTask("Same request", "owner", "a3333333-3333-4333-8333-333333333333", sql);
    const two = await createTask("Same request", "owner", "a4444444-4444-4444-8444-444444444444", sql);
    assert.notEqual(one.id, two.id);
    await assert.rejects(createTask("Different request", "owner", "a3333333-3333-4333-8333-333333333333", sql), /already bound/);
    const events = await sql`SELECT * FROM engineering_events WHERE action='intake'`;
    assert.equal(events.length, 2);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("task submission keys reject missing, malformed, and oversized values", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    for (const key of [undefined, "not-a-uuid", "a".repeat(37)]) {
      await assert.rejects(createTask("Request", "owner", key as string, sql), /submission key/);
    }
    const tasks = await sql`SELECT * FROM engineering_tasks`;
    assert.equal(tasks.length, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("Postgres control plane enforces approval, versions, evidence cycles, and costs atomically", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-initial-attempt-preparation.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-binding.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-selection-policy.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
     await db.exec(await readFile(new URL("../../../sql/engineering-approval-execution-separation.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-prepared-subject-supersession.sql", import.meta.url), "utf8"));
    const adapter = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      return (await db.query(query, values)).rows;
    };
    const sql = adapter as unknown as ReturnType<typeof getSql>;
    let task = await createTask("Fix isolated feature", "owner", "a5555555-5555-4555-8555-555555555555", sql);
    await assert.rejects(actOnTask(task.id, task.version, "transition", "implementing", "owner", sql));
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "Bounded fix", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] }, "owner", sql);
    task = await prepareInitialAttempt(task.id, task.version, "owner", sql);
    const approvalVersion = task.version;
    const prepared = (await sql`SELECT attempt_id FROM engineering_prepared_attempts WHERE task_id=${task.id}::uuid`)[0] as { attempt_id: string };
    const approvals = await Promise.allSettled([
      approvePreparedAttempt(task.id, task.version, prepared.attempt_id, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
      approvePreparedAttempt(task.id, task.version, prepared.attempt_id, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
    ]);
    assert.equal(approvals.filter(a => a.status === "fulfilled").length, 1);
    assert.equal(approvals.filter(a => a.status === "rejected").length, 1);
    task = (await taskHistory(task.id, sql)).task!;
    await assert.rejects(storeActOnTask(task.id, approvalVersion, "approve", null, "owner", sql), /separate actions/);
    let history = await taskHistory(task.id, sql);
    assert.equal(history.approvals.length, 1);
    assert.equal(history.runs.length, 0);
    assert.equal(history.task!.status, "awaiting_execution");
    assert.equal(history.task!.version, approvalVersion);
    assert.equal(history.events.length, 5);
    assert.equal((await sql`SELECT * FROM engineering_run_lineage WHERE task_id=${task.id}::uuid`).length, 0);
    await assert.rejects(db.query("SELECT engineering_worker($1::uuid,'claim','synthetic-worker',0,$2::jsonb)", [prepared.attempt_id, JSON.stringify({ preflightRevision: "e".repeat(40) })]));
    await authorizePreparedExecution(task.id, approvalVersion, prepared.attempt_id, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision);
    await sql`UPDATE engineering_runs SET worker_enabled=false WHERE id=${prepared.attempt_id}::uuid`;
    task = (await taskHistory(task.id, sql)).task!;
    assert.equal(task.status, "implementing");
    assert.equal(task.version, approvalVersion + 1);
    history = await taskHistory(task.id, sql);
    assert.equal(history.runs.length, 1);
    assert.equal(history.events.length, 6);
    task = await actOnTask(task.id, task.version, "transition", "validating", "owner", sql);
    await assert.rejects(actOnTask(task.id, task.version, "transition", "reviewing", "owner", sql));
    const evidence = { kind: "validation", command: "lint", outcome: "failed", revision: "a".repeat(40), summary: "Lint failure" };
    await recordRunEvidence(task.id, task.version, evidence, "owner", sql);
    task = (await taskHistory(task.id, sql)).task!;
    await assert.rejects(recordRunEvidence(task.id, task.version, { ...evidence, command: "typecheck", revision: "b".repeat(40) }, "owner", sql));
    for (let repair = 1; repair <= 3; repair++) {
      task = await actOnTask(task.id, task.version, "transition", "repairing", "owner", sql);
      task = await actOnTask(task.id, task.version, "transition", "validating", "owner", sql);
      await assert.rejects(actOnTask(task.id, task.version, "transition", "reviewing", "owner", sql));
      await recordRunEvidence(task.id, task.version, evidence, "owner", sql);
      task = (await taskHistory(task.id, sql)).task!;
    }
    await assert.rejects(actOnTask(task.id, task.version, "transition", "repairing", "owner", sql));
    await assert.rejects(recordRunEvidence(task.id, task.version, { kind: "cost", provider: "test", model: "efficient", operation: "implementation", tokens: 10, estimatedCostUsd: 5.01 }, "owner", sql));
    await recordRunEvidence(task.id, task.version, { kind: "cost", provider: "test", model: "efficient", operation: "implementation", tokens: 10, estimatedCostUsd: 5 }, "owner", sql);
    task = (await taskHistory(task.id, sql)).task!;
    await assert.rejects(recordRunEvidence(task.id, task.version, { kind: "cost", provider: "test", model: "efficient", operation: "repair", tokens: 10, estimatedCostUsd: .01 }, "owner", sql));
    history = await taskHistory(task.id, sql);
    assert.equal(history.costs.length, 1);
    assert.equal(Number(history.runs[0].cost_usd), 5);
    assert.equal(history.runs[0].repairs, 3);
    await db.exec("UPDATE engineering_runs SET started_at=now()-interval '31 minutes'");
    await assert.rejects(recordRunEvidence(task.id, task.version, { ...evidence, command: "typecheck" }, "owner", sql));
    task = await actOnTask(task.id, task.version, "transition", "blocked", "owner", sql);
    assert.ok((await taskHistory(task.id, sql)).runs[0].finished_at);
    await assert.rejects(actOnTask(task.id, task.version, "transition", "validating", "owner", sql));
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("successful validation can reach review, with no merge transition", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-initial-attempt-preparation.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-binding.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-selection-policy.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
     await db.exec(await readFile(new URL("../../../sql/engineering-approval-execution-separation.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-prepared-subject-supersession.sql", import.meta.url), "utf8"));
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as unknown as ReturnType<typeof getSql>;
    let task = await createTask("Small fix", "owner", "a6666666-6666-4666-8666-666666666666", sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "Fix", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] }, "owner", sql);
    task = await prepareInitialAttempt(task.id, task.version, "owner", sql);
    task = await approveAndAuthorize(task.id, task.version, "owner", sql, false);
    const cost = { kind: "cost", provider: "test", model: "efficient", operation: "triage", tokens: 0, estimatedCostUsd: 0 };
    await assert.rejects(recordRunEvidence(task.id, task.version, { ...cost, tokens: 60001 }, "owner", sql));
    for (let call = 0; call < 12; call++) {
      await recordRunEvidence(task.id, task.version, cost, "owner", sql);
      task = (await taskHistory(task.id, sql)).task!;
    }
    await assert.rejects(recordRunEvidence(task.id, task.version, cost, "owner", sql));
    assert.equal((await taskHistory(task.id, sql)).runs[0].model_calls, 12);
    task = await actOnTask(task.id, task.version, "transition", "validating", "owner", sql);
    await recordRunEvidence(task.id, task.version, { kind: "validation", command: "lint", outcome: "passed", revision: "c".repeat(40), summary: "Passed" }, "owner", sql);
    task = (await taskHistory(task.id, sql)).task!;
    task = await actOnTask(task.id, task.version, "transition", "reviewing", "owner", sql);
    task = await actOnTask(task.id, task.version, "transition", "awaiting_merge", "owner", sql);
    await assert.rejects(actOnTask(task.id, task.version, "transition", "merged", "owner", sql));
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});


test("evidence audit events contain only allowlisted metadata, with detailed records authoritative", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-lineage.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-initial-attempt-preparation.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-binding.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-source-selection-policy.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../sql/engineering-merge.sql", import.meta.url), "utf8"));
     await db.exec(await readFile(new URL("../../../sql/engineering-approval-execution-separation.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-prepared-subject-supersession.sql", import.meta.url), "utf8"));
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as unknown as ReturnType<typeof getSql>;
    let task = await createTask("Audit isolation", "owner", "a7777777-7777-4777-8777-777777777777", sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "Fix", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] }, "owner", sql);
    task = await prepareInitialAttempt(task.id, task.version, "owner", sql);
    task = await approveAndAuthorize(task.id, task.version, "owner", sql, false);
    task = await actOnTask(task.id, task.version, "transition", "validating", "owner", sql);
    const validationVersion = task.version;
    const unexpected = { secret: "unexpected-secret", nested: { privateData: "private" }, runId: "forged", cycle: 999, version: 999 };
    await recordRunEvidence(task.id, task.version, { ...unexpected, kind: "validation", command: "lint", outcome: "passed", revision: "d".repeat(40), summary: "Detailed validation text", provider: "unexpected-provider", model: "unexpected-model" }, "owner", sql);
    task = (await taskHistory(task.id, sql)).task!;
    const costVersion = task.version;
    await recordRunEvidence(task.id, task.version, { ...unexpected, kind: "cost", provider: "test-provider", model: "test-model", operation: "triage", tokens: 42, estimatedCostUsd: 0.01, summary: "Unexpected cost text" }, "owner", sql);
    const history = await taskHistory(task.id, sql);
    const runId = history.runs[0].id;
    assert.deepEqual(history.events.find(event => event.action === "validation")!.details, { kind: "validation", version: validationVersion, command: "lint", outcome: "passed", revision: "d".repeat(40), runId, cycle: 0 });
    assert.deepEqual(history.events.find(event => event.action === "cost")!.details, { kind: "cost", version: costVersion, tokens: 42, estimatedCostUsd: 0.01, runId, cycle: 0 });
    assert.equal(history.validations[0].summary, "Detailed validation text");
    assert.equal(history.costs[0].provider, "test-provider");
    assert.equal(history.costs[0].model, "test-model");
    assert.equal(history.costs[0].operation, "triage");
    assert.equal(history.events.filter(event => ["validation", "cost"].includes(String(event.action))).every(event => event.actor === "owner" && event.task_id === task.id), true);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("expired execution is preserved and a same-request retry requires a fresh plan approval and run", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const originalRequest = "Synthetic lifecycle request";
    const submissionKey = "a8888888-8888-4888-8888-888888888888";
    const prepareKey = "a9999999-9999-4999-8999-999999999999";
    const plan = { summary: "A small documentation change", files: ["README.md"], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"], operations: [] };
    let task = await createTask(originalRequest, "human", submissionKey, sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "human", sql);
    task = await actOnTask(task.id, task.version, "plan", plan, "human", sql);
    const initialPlanVersion = task.version;
    task = await prepareInitialAttempt(task.id, task.version, "human", sql);
    const oldPlanVersion = initialPlanVersion;
    task = await approveAndAuthorize(task.id, task.version, "human", sql);
    const firstHistory = await taskHistory(task.id, sql);
    const firstRun = firstHistory.runs[0];
    const firstRunId = String(firstRun.id);
    assert.equal(task.status, "implementing");
    assert.equal(task.version, 3);

    await assert.rejects(prepareFreshAttempt(task.id, task.version, "a9999999-9999-4999-8999-999999999998", "human", sql), /not safely closed|not available for this request state/);
    assert.equal((await sql`SELECT finished_at FROM engineering_runs WHERE id=${String(firstHistory.runs[0].id)}::uuid`)[0].finished_at, null);

    await sql`UPDATE engineering_runs SET started_at=now()-interval '31 minutes',lease_owner='synthetic-worker',lease_epoch=7,lease_until=now()-interval '1 minute',preflight_revision=${"e".repeat(40)},worker_revision=${"b".repeat(40)},model_calls=1,tokens=23,cost_usd=0.001 WHERE id=${firstRunId}::uuid`;
    await sql`INSERT INTO engineering_costs(id,run_id,provider,model,operation,tokens,estimated_cost_usd) VALUES ('a1111111-1111-4111-8111-111111111111',${firstRunId}::uuid,'synthetic','synthetic','fixture',23,0.001)`;
    await sql`INSERT INTO engineering_validations(id,run_id,command,outcome,revision,summary,cycle) VALUES ('a2222222-2222-4222-8222-222222222222',${firstRunId}::uuid,'lint','passed',${"b".repeat(40)},'synthetic fixture',0)`;
    const before = (await sql`SELECT * FROM engineering_runs WHERE id=${firstRunId}::uuid`)[0];
    const approvalBefore = await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`;
    assert.equal(approvalBefore.length, 1);
    assert.equal((await listTasks(sql)).find(item => item.id === task.id)!.attempts![0].disposition, "expired");

    const [prepared, duplicatePreparation] = await Promise.all([
      prepareFreshAttempt(task.id, task.version, prepareKey, "human", sql),
      prepareFreshAttempt(task.id, task.version, prepareKey, "human", sql),
    ]);
    assert.equal((prepared.task as Record<string, unknown>).status, "analyzing");
    assert.equal(Number((prepared.task as Record<string, unknown>).version), 4);
    assert.deepEqual([prepared.replayed, duplicatePreparation.replayed].sort(), [false, true]);
    const replay = await prepareFreshAttempt(task.id, task.version, prepareKey, "human", sql);
    assert.equal(replay.replayed, true);
    assert.equal((await sql`SELECT * FROM engineering_attempt_preparations WHERE task_id=${task.id}::uuid`).length, 1);
    assert.equal((await sql`SELECT * FROM engineering_events WHERE task_id=${task.id}::uuid AND action='prepare_attempt'`).length, 1);
    const preparedLineage = (await sql`SELECT target_repository,target_branch,target_base_sha FROM engineering_attempt_preparations WHERE task_id=${task.id}::uuid`)[0] as Record<string,unknown>;
    assert.deepEqual(preparedLineage,{target_repository:"omarimckie/MediMori",target_branch:"main",target_base_sha:testTargetSha});
    await assert.rejects(sql`UPDATE engineering_attempt_preparations SET target_base_sha=${"d".repeat(40)} WHERE idempotency_key=${prepareKey}::uuid`);
    await assert.rejects(sql`DELETE FROM engineering_plan_lineage WHERE task_id=${task.id}::uuid AND plan_version=${oldPlanVersion}`);
    await assert.rejects(sql`UPDATE engineering_run_lineage SET target_base_sha=${"d".repeat(40)} WHERE run_id=${firstRunId}::uuid`);

    const oldAfterPrepare = (await sql`SELECT * FROM engineering_runs WHERE id=${firstRunId}::uuid`)[0];
    for (const field of ["lease_owner", "lease_epoch", "lease_until", "preflight_revision", "worker_revision", "model_calls", "tokens", "cost_usd", "plan_version", "plan_snapshot"]) assert.deepEqual(oldAfterPrepare[field], before[field], `${field} must remain historical evidence`);
    assert.ok(oldAfterPrepare.finished_at);
    assert.equal(oldAfterPrepare.disposition, "expired");
    assert.equal((await sql`SELECT * FROM engineering_costs WHERE run_id=${firstRunId}::uuid`).length, 1);
    assert.equal((await sql`SELECT * FROM engineering_validations WHERE run_id=${firstRunId}::uuid`).length, 1);
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid AND plan_version=${oldPlanVersion}`).length, 1);

    await assert.rejects(prepareFreshAttempt(task.id, task.version - 1, "a3333333-3333-4333-8333-333333333333", "human", sql));
    task = (await taskHistory(task.id, sql)).task!;
    task = await actOnTask(task.id, task.version, "plan", plan, "human", sql);
    const freshPlanVersion = task.version;
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 1, "planning alone must not create a run");
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 1, "prior approval cannot authorize a fresh run");
    let sourceReads = 0;
    const retryKeys = ["a4444444-4444-4444-8444-444444444444", "a5555555-5555-4555-8555-555555555555"];
    const retryAttempts = await Promise.allSettled(retryKeys.map(key => prepareRetryAttemptSubject(task.id, task.version, key, "human", sql, async () => { sourceReads++; return "f".repeat(40); })));
    assert.equal(retryAttempts.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(retryAttempts.filter(item => item.status === "rejected").length, 1);
    const winnerIndex = retryAttempts.findIndex(item => item.status === "fulfilled");
    const retrySubject = (retryAttempts[winnerIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof prepareRetryAttemptSubject>>>).value;
    assert.equal(retrySubject.ok, true);
    assert.equal(retrySubject.attemptNumber, 2);
    assert.equal(retrySubject.implementationSourceRevision, "f".repeat(40));
    assert.equal(sourceReads, 2, "concurrent retry candidates each recompute source rather than inherit it");
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${task.id}::uuid`).length, 1, "retry preparation does not create an executable run");
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${task.id}::uuid`).length, 1, "retry preparation does not create approval");
    const retryPrepared = (await sql`SELECT * FROM engineering_prepared_attempts WHERE attempt_id=${retrySubject.attemptId}::uuid`)[0] as Record<string,unknown>;
    assert.equal(retryPrepared.implementation_source_revision, "f".repeat(40));
    assert.equal(Number(retryPrepared.source_selection_policy_version),2);
    const retryReplay = await prepareRetryAttemptSubject(task.id, task.version, retryKeys[winnerIndex], "human", sql, async () => "f".repeat(40));
    assert.equal(retryReplay.replayed, true);
    assert.equal(retryReplay.attemptId, retrySubject.attemptId);
    await assert.rejects(prepareRetryAttemptSubject(task.id, task.version, retryKeys[winnerIndex], "human", sql, async () => "b".repeat(40)), /Task changed|different request|retry subject/i);
    await assert.rejects(approvePreparedAttempt(task.id, task.version, retrySubject.attemptId, "human", sql, readTestTargetSha, readTestPreimages, async () => "b".repeat(40)), /implementation source changed/);
    await approvePreparedAttempt(task.id, task.version, retrySubject.attemptId, "human", sql, readTestTargetSha, readTestPreimages, async () => "f".repeat(40));
    await authorizePreparedExecution(task.id, task.version, retrySubject.attemptId, "human", sql, readTestTargetSha, readTestPreimages, async () => "f".repeat(40));
    task = (await taskHistory(task.id, sql)).task!;
    const history = await taskHistory(task.id, sql);
    assert.equal(history.task!.request, originalRequest);
    assert.equal(task.status, "implementing");
    assert.equal(history.runs.length, 2);
    const freshRun = history.runs.find(run => run.id !== firstRunId)!;
    assert.equal(freshRun.attempt_number, 2);
    assert.equal(freshRun.plan_version, freshPlanVersion);
    assert.equal(freshRun.disposition, "active");
    const runLineage = (await sql`SELECT * FROM engineering_run_lineage WHERE run_id=${freshRun.id}::uuid`)[0] as Record<string,unknown>;
    assert.equal(runLineage.task_id,task.id);
    assert.equal(Number(runLineage.attempt_number),2);
    assert.equal(Number(runLineage.plan_version),freshPlanVersion);
    assert.equal(runLineage.target_base_sha,testTargetSha);
    assert.equal(runLineage.implementation_source_revision, "f".repeat(40));
    assert.equal(Number(runLineage.source_binding_version),1);
    assert.equal(Number(runLineage.source_selection_policy_version),2);
    assert.equal(runLineage.previous_run_id,firstRunId);
    assert.ok(new Date(String(freshRun.started_at)).getTime() > Date.now() - 60_000);
    assert.equal(history.approvals.length, 2);
    assert.ok(history.approvals.some(approval => approval.plan_version === freshPlanVersion && approval.decision === "approved"));
    assert.equal(Number(freshRun.model_calls), 0);
    assert.equal(Number(freshRun.tokens), 0);
    assert.equal(Number(freshRun.cost_usd), 0);
    assert.equal((await sql`SELECT * FROM engineering_worker_calls WHERE run_id=${freshRun.id}::uuid`).length, 0);

    const oldClaim = () => db.query("SELECT engineering_worker($1::uuid,'claim','synthetic-worker',0,$2::jsonb)", [firstRunId, JSON.stringify({ preflightRevision: "e".repeat(40) })]);
    await assert.rejects(oldClaim(), /stale_attempt|lease_denied/i);
    const claim = await db.query<{ result: Record<string, unknown> }>("SELECT engineering_worker($1::uuid,'claim','synthetic-worker',0,$2::jsonb) result", [freshRun.id, JSON.stringify({ preflightRevision: "f".repeat(40) })]);
    assert.equal(claim.rows[0].result.preflight_revision, "f".repeat(40));
    const listed = (await listTasks(sql)).find(item => item.id === task.id)!;
    assert.equal(listed.attempts!.length, 2);
    assert.equal(listed.latestPreparation!.previousAttemptNumber, 1);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; delete process.env.ENGINEERING_WORKER_ENABLED; }
});

test("attempt preparation stays human-only and preserves the restricted worker database boundary", async () => {
  const { db } = await createTestSql();
  try {
    const result = await db.query<{ preparation_public: boolean; preparation_worker: boolean; worker_ingress_worker: boolean; task_update: boolean; approval_update: boolean }>(`
      SELECT
        EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid='engineering_prepare_attempt(uuid,integer,uuid,text)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS preparation_public,
        has_function_privilege('medimori_engineering_worker','engineering_prepare_attempt(uuid,integer,uuid,text)','EXECUTE') AS preparation_worker,
        has_function_privilege('medimori_engineering_worker','engineering_worker(uuid,text,text,integer,jsonb)','EXECUTE') AS worker_ingress_worker,
        has_table_privilege('medimori_engineering_worker','engineering_tasks','UPDATE') AS task_update,
        has_table_privilege('medimori_engineering_worker','engineering_approvals','UPDATE') AS approval_update
    `);
    assert.deepEqual(result.rows[0], { preparation_public: false, preparation_worker: false, worker_ingress_worker: true, task_update: false, approval_update: false });
  } finally { await db.close(); }
});


async function createSupersessionFixture(sql: ReturnType<typeof getSql>) {
  const plan = { summary: "Clarify README source path", files: ["README.md"], validations: [...validationCommands], operations: [] };
  const task = await createTask("Clarify README page source", "owner", randomUUID(), sql);
  await sql`UPDATE engineering_tasks SET status='awaiting_approval',version=5,plan=${JSON.stringify(plan)}::jsonb,risk='low' WHERE id=${task.id}::uuid`;
  const previousRunId = randomUUID();
  const preparationKey = randomUUID();
  const staleAttemptId = randomUUID();
  const staleTarget = "a".repeat(40);
  await sql`INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,disposition,started_at,finished_at,reserved_tokens,reserved_micros)
    VALUES(${previousRunId}::uuid,${task.id}::uuid,3,false,1,${JSON.stringify(plan)}::jsonb,'expired',now()-interval '2 hours',now()-interval '90 minutes',0,0)`;
  await sql`INSERT INTO engineering_attempt_preparations(idempotency_key,task_id,previous_run_id,actor,from_version,to_version,previous_attempt_number,previous_disposition,previous_plan,previous_risk)
    VALUES(${preparationKey}::uuid,${task.id}::uuid,${previousRunId}::uuid,'owner',3,4,1,'expired',${JSON.stringify(plan)}::jsonb,'low')`;
  await sql`INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,subject_generation,plan_version,idempotency_key,actor,request_snapshot,plan_snapshot,risk,
      target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision,source_selection_policy_version,previous_run_id,retry_preparation_key)
    VALUES(${staleAttemptId}::uuid,${task.id}::uuid,2,1,5,${randomUUID()}::uuid,'owner','Clarify README page source',${JSON.stringify(plan)}::jsonb,'low',
      'omarimckie/MediMori','main',${staleTarget},${JSON.stringify({ "README.md": "b".repeat(64) })}::jsonb,${"c".repeat(40)},2,${previousRunId}::uuid,${preparationKey}::uuid)`;
  await sql`INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
    VALUES(${task.id}::uuid,5,'omarimckie/MediMori','main',${staleTarget})`;
  return { taskId: task.id, staleAttemptId, previousRunId, plan, staleTarget };
}

const readFreshSupersessionTarget = async () => "d".repeat(40);
const readFreshSupersessionPreimages = async (_sha: string, paths: readonly string[]) => Object.fromEntries(paths.map(path => [path, "e".repeat(64)]));
const readFreshSupersessionSource = async () => "f".repeat(40);

test("stale unapproved Attempt #2 is superseded atomically by generation 2 without changing its immutable subject", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const fixture = await createSupersessionFixture(sql);
    const oldBefore = (await sql`SELECT * FROM engineering_prepared_attempts WHERE attempt_id=${fixture.staleAttemptId}::uuid`)[0];
    const key = "a5555555-5555-4555-8555-555555555555";
    const [first, concurrentReplay] = await Promise.all([
      supersedeStalePreparedAttempt(fixture.taskId, 5, fixture.staleAttemptId, key, "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource),
      supersedeStalePreparedAttempt(fixture.taskId, 5, fixture.staleAttemptId, key, "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource),
    ]);
    assert.equal(first.attemptNumber, 2);
    assert.equal(first.subjectGeneration, 2);
    assert.equal(first.planVersion, 6);
    assert.equal(first.replayed || concurrentReplay.replayed, true);
    assert.equal(first.attemptId, concurrentReplay.attemptId);
    const task = (await taskHistory(fixture.taskId, sql)).task!;
    assert.equal(task.status, "awaiting_approval");
    assert.equal(task.version, 6);
    assert.deepEqual(task.plan, fixture.plan);
    const oldAfter = (await sql`SELECT * FROM engineering_prepared_attempts WHERE attempt_id=${fixture.staleAttemptId}::uuid`)[0];
    assert.deepEqual(oldAfter, oldBefore, "old P+T+S row remains byte-for-byte unchanged");
    const generations = await sql`SELECT attempt_id,subject_generation,state,superseded_by_attempt_id,supersedes_attempt_id FROM engineering_prepared_subject_generations WHERE task_id=${fixture.taskId}::uuid AND attempt_number=2 ORDER BY subject_generation`;
    assert.equal(generations.length, 2);
    assert.equal(generations.filter(row => row.state === "active").length, 1);
    assert.deepEqual(generations.map(row => row.state), ["superseded", "active"]);
    assert.equal(generations[0].superseded_by_attempt_id, first.attemptId);
    assert.equal(generations[1].supersedes_attempt_id, fixture.staleAttemptId);
    const supersessions = await sql`SELECT * FROM engineering_prepared_subject_supersessions WHERE task_id=${fixture.taskId}::uuid`;
    assert.equal(supersessions.length, 1, "same-key replay adds no duplicate supersession record");
    assert.equal((await sql`SELECT * FROM engineering_events WHERE task_id=${fixture.taskId}::uuid AND action='prepared_subject_superseded'`).length, 1);
    assert.equal((await sql`SELECT * FROM engineering_runs WHERE task_id=${fixture.taskId}::uuid AND attempt_number=2`).length, 0);
    assert.equal((await sql`SELECT * FROM engineering_approvals WHERE task_id=${fixture.taskId}::uuid AND plan_version=6`).length, 0);
    assert.equal((await sql`SELECT target_base_sha FROM engineering_plan_lineage WHERE task_id=${fixture.taskId}::uuid AND plan_version=6`)[0].target_base_sha, "d".repeat(40));
    const listed = (await listTasks(sql)).find(item => item.id === fixture.taskId)!;
    assert.equal(listed.preparedAttempt?.attemptId, first.attemptId, "UI lookup exposes active generation only");
    assert.equal(listed.preparedAttempt?.subjectGeneration, 2);

    await assert.rejects(approvePreparedAttempt(fixture.taskId, 6, fixture.staleAttemptId, "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));
    await assert.rejects(supersedeStalePreparedAttempt(fixture.taskId, 5, fixture.staleAttemptId, key, "other-owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource), /different request/);
    await assert.rejects(supersedeStalePreparedAttempt(fixture.taskId, 5, randomUUID(), "a6666666-6666-4666-8666-666666666666", "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));
    await assert.rejects(supersedeStalePreparedAttempt(fixture.taskId, 4, fixture.staleAttemptId, "a7777777-7777-4777-8777-777777777777", "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));

    const replacement = (await sql`SELECT * FROM engineering_prepared_attempts WHERE attempt_id=${first.attemptId}::uuid`)[0];
    assert.equal(replacement.plan_version, 6);
    assert.equal(replacement.attempt_number, 2);
    assert.equal(replacement.subject_generation, 2);
    assert.deepEqual(replacement.plan_snapshot, fixture.plan);
    assert.equal(replacement.target_base_sha, "d".repeat(40));
    assert.equal(replacement.implementation_source_revision, "f".repeat(40));

    await approvePreparedAttempt(fixture.taskId, 6, String(first.attemptId), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource);
    await authorizePreparedExecution(fixture.taskId, 6, String(first.attemptId), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource);
    assert.equal((await sql`SELECT id,attempt_number,plan_version FROM engineering_runs WHERE task_id=${fixture.taskId}::uuid AND attempt_number=2`)[0].id, first.attemptId);
    assert.equal((await sql`SELECT engineering_run_lineage_valid(${first.attemptId}::uuid) AS valid`)[0].valid, true, "generation 2 approval and run lineage are valid");
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("supersession rejects approved or executed stale subjects and rolls back a late lineage constraint failure", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const approved = await createSupersessionFixture(sql);
    await sql`INSERT INTO engineering_approvals(id,task_id,plan_version,prepared_attempt_id,gate,decision,actor)
      VALUES(${randomUUID()}::uuid,${approved.taskId}::uuid,5,${approved.staleAttemptId}::uuid,'plan','rejected','owner')`;
    await assert.rejects(supersedeStalePreparedAttempt(approved.taskId, 5, approved.staleAttemptId, randomUUID(), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));
    assert.equal((await sql`SELECT state FROM engineering_prepared_subject_generations WHERE attempt_id=${approved.staleAttemptId}::uuid`)[0].state, "active");

    const executed = await createSupersessionFixture(sql);
    await sql`INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,disposition,started_at,reserved_tokens,reserved_micros)
      VALUES(${randomUUID()}::uuid,${executed.taskId}::uuid,5,true,2,${JSON.stringify(executed.plan)}::jsonb,'active',now(),0,0)`;
    await assert.rejects(supersedeStalePreparedAttempt(executed.taskId, 5, executed.staleAttemptId, randomUUID(), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));
    assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_prepared_attempts WHERE task_id=${executed.taskId}::uuid AND subject_generation=2`)[0].count, 0);

    const rollback = await createSupersessionFixture(sql);
    await sql`INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
      VALUES(${rollback.taskId}::uuid,6,'omarimckie/MediMori','main',${"9".repeat(40)})`;
    await assert.rejects(supersedeStalePreparedAttempt(rollback.taskId, 5, rollback.staleAttemptId, randomUUID(), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));
    assert.equal((await sql`SELECT version,status FROM engineering_tasks WHERE id=${rollback.taskId}::uuid`)[0].version, 5);
    assert.equal((await sql`SELECT state FROM engineering_prepared_subject_generations WHERE attempt_id=${rollback.staleAttemptId}::uuid`)[0].state, "active");
    assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_prepared_attempts WHERE task_id=${rollback.taskId}::uuid AND subject_generation=2`)[0].count, 0);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_events WHERE task_id=${rollback.taskId}::uuid AND action='prepared_subject_superseded'`)[0].count, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("prepared-subject migration enforces one active generation and denies worker/public lifecycle mutation", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const fixture = await createSupersessionFixture(sql);
    const privileges = await sql`SELECT
      has_function_privilege('medimori_engineering_2c_worker','engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint)','EXECUTE') AS worker_execute,
      has_function_privilege('medimori_engineering_merge_executor','engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint)','EXECUTE') AS merge_execute,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
      has_table_privilege('medimori_engineering_2c_worker','engineering_prepared_subject_generations','UPDATE') AS worker_metadata_update,
      has_table_privilege('medimori_engineering_merge_executor','engineering_prepared_subject_generations','UPDATE') AS merge_metadata_update`;
    assert.deepEqual(privileges[0], { worker_execute: false, merge_execute: false, public_execute: false, worker_metadata_update: false, merge_metadata_update: false });
    await assert.rejects(sql`INSERT INTO engineering_prepared_subject_generations(attempt_id,task_id,attempt_number,subject_generation,state)
      VALUES(${randomUUID()}::uuid,${fixture.taskId}::uuid,2,1,'active')`);
    await assert.rejects(sql`UPDATE engineering_prepared_attempts SET target_base_sha=${"9".repeat(40)} WHERE attempt_id=${fixture.staleAttemptId}::uuid`);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_runs WHERE task_id=${fixture.taskId}::uuid AND attempt_number=2`)[0].count, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});


test("supersession and approval serialize on the task version so only one subject outcome wins", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const fixture = await createSupersessionFixture(sql);
    const results = await Promise.allSettled([
      supersedeStalePreparedAttempt(fixture.taskId, 5, fixture.staleAttemptId, randomUUID(), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource),
      approvePreparedAttempt(fixture.taskId, 5, fixture.staleAttemptId, "owner", sql, readTestTargetSha, readTestPreimages, testSourceRevision),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    const task = (await taskHistory(fixture.taskId, sql)).task!;
    const active = (await sql`SELECT p.attempt_id,p.plan_version,p.subject_generation,g.state FROM engineering_prepared_attempts p
      JOIN engineering_prepared_subject_generations g ON g.attempt_id=p.attempt_id AND g.state='active' WHERE p.task_id=${fixture.taskId}::uuid AND p.attempt_number=2`);
    assert.equal(active.length, 1);
    if (task.version === 6) {
      assert.equal(task.status, "awaiting_approval");
      assert.equal(Number(active[0].subject_generation), 2);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_approvals WHERE task_id=${fixture.taskId}::uuid AND plan_version=5 AND gate='plan'`)[0].count, 0);
    } else {
      assert.equal(task.version, 5);
      assert.equal(task.status, "awaiting_execution");
      assert.equal(active[0].attempt_id, fixture.staleAttemptId);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_approvals WHERE task_id=${fixture.taskId}::uuid AND prepared_attempt_id=${fixture.staleAttemptId}::uuid AND decision='approved'`)[0].count, 1);
      await assert.rejects(supersedeStalePreparedAttempt(fixture.taskId, 5, fixture.staleAttemptId, randomUUID(), "owner", sql, readFreshSupersessionTarget, readFreshSupersessionPreimages, readFreshSupersessionSource));
    }
    assert.equal((await sql`SELECT count(*)::integer AS count FROM engineering_runs WHERE task_id=${fixture.taskId}::uuid AND attempt_number=2`)[0].count, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});
