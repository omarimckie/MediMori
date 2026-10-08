import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sanitizedInitializationDiagnostic, WorkerInitializationError } from "./worker-initialization";
import { verifyWorkerDatabaseIdentityQuery } from "./worker-database";

function validIdentityRow() {
  return {
    actor: "medimori_engineering_2c_worker",
    session_actor: "medimori_engineering_2c_worker",
    branch_id: "br-little-art-au7ke21s",
    database_name: "neondb",
    role_exists: true,
    role_member: true,
    role_superuser: false,
    role_createdb: false,
    role_createrole: false,
    role_replication: false,
    role_bypassrls: false,
    task_mutation: false,
    approval_mutation: false,
    ingress_exists: true,
    ingress_security_definer: true,
    ingress_execute: true,
    public_execute: false,
    worker_call_progress_ready: true,
    worker_lineage_ready: true,
    source_binding_ready: true,
    source_mismatch_execute: true,
    source_mismatch_public_execute: false,
    preclaim_diagnostic_ready: true,
    lineage_table_access: false,
  };
}

function queryReturning(row: unknown) {
  return (async () => [row]) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

test("read-only identity query accepts the intended disposable restricted role", async () => {
  const query = queryReturning(validIdentityRow());
  const identity = await verifyWorkerDatabaseIdentityQuery(query);
  assert.equal(identity.branchId, "br-little-art-au7ke21s");
  assert.equal(identity.currentUser, "medimori_engineering_2c_worker");
  assert.equal(identity.sessionUser, identity.currentUser);
  assert.equal(identity.boundedPrivileges, true);
  assert.equal(identity.lineageReady, true);
  assert.equal(identity.preclaimDiagnosticsReady, true);
});

test("identity query classifies branch and role mismatches without raw database details", async () => {
  for (const [change, expected] of [
    [{ branch_id: "another-branch" }, "worker_database_branch_mismatch"],
    [{ actor: "admin", session_actor: "admin" }, "worker_database_role_mismatch"],
  ] as const) {
    await assert.rejects(
      verifyWorkerDatabaseIdentityQuery(queryReturning({ ...validIdentityRow(), ...change })),
      error => error instanceof WorkerInitializationError && error.code === expected,
    );
  }
});

test("identity query rejects unsafe privileges and ingress grants", async () => {
for (const change of [{ role_superuser: true }, { task_mutation: true }, { approval_mutation: true }, { lineage_table_access: true }, { ingress_execute: false }, { public_execute: true }, { source_mismatch_execute: false }, { source_mismatch_public_execute: true }]) {
    await assert.rejects(
      verifyWorkerDatabaseIdentityQuery(queryReturning({ ...validIdentityRow(), ...change })),
      error => error instanceof WorkerInitializationError && error.code === "worker_database_identity_mismatch",
    );
  }
});

test("identity query fails closed before claim when call-progress or lineage schema is missing", async () => {
for (const change of [{ worker_call_progress_ready: false }, { worker_lineage_ready: false }, { source_binding_ready: false }, { preclaim_diagnostic_ready: false }]) {
    await assert.rejects(
      verifyWorkerDatabaseIdentityQuery(queryReturning({ ...validIdentityRow(), ...change })),
      error => error instanceof WorkerInitializationError && error.code === "worker_database_schema_mismatch",
    );
  }
  const diagnostic = sanitizedInitializationDiagnostic(new WorkerInitializationError("database_identity", "worker_database_schema_mismatch"));
  assert.equal(diagnostic.beforeClaim, true);
  assert.equal(diagnostic.providerCouldHaveBeenReached, false);
  assert.equal(diagnostic.dockerCouldHaveBeenReached, false);
  assert.equal(JSON.stringify(diagnostic).includes("processing_state"), false);
});

test("identity query distinguishes SQL/query failures from connection failures safely", async () => {
  const queryError = Object.assign(new Error("private database host and credentials"), { code: "42501" });
  const connectionError = Object.assign(new Error("private connection URL"), { code: "ECONNRESET" });
  for (const [error, expected] of [[queryError, "worker_database_identity_query_failed"], [connectionError, "worker_database_connection_failed"]] as const) {
    const query = (async () => { throw error; }) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
    await assert.rejects(verifyWorkerDatabaseIdentityQuery(query), failure => failure instanceof WorkerInitializationError && failure.code === expected);
    const diagnostic = sanitizedInitializationDiagnostic(new WorkerInitializationError("database_identity", expected));
    assert.equal(JSON.stringify(diagnostic).includes("private"), false);
    assert.equal(diagnostic.beforeClaim, true);
  }
});

test("call-progress schema migration preserves legacy rows and defaults only future rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(`CREATE TABLE engineering_worker_calls (
      run_id uuid NOT NULL, call_key text NOT NULL, request_hash text NOT NULL,
      model text NOT NULL, reserved_tokens integer NOT NULL, reserved_micros bigint NOT NULL,
      state text NOT NULL DEFAULT 'reserved', actual_input integer, actual_output integer,
      actual_micros bigint, response_id text, rate_snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,call_key), UNIQUE(response_id)
    );
    INSERT INTO engineering_worker_calls(run_id,call_key,request_hash,model,reserved_tokens,reserved_micros,state,actual_input,actual_output,actual_micros,rate_snapshot)
    VALUES('11111111-1111-4111-8111-111111111111','legacy','hash','gpt-6-luna',100,100,'settled',50,25,7,'{}'::jsonb);`);
    await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
    const legacy = (await db.query<{ processing_state: string | null; state: string; actual_micros: number }>("SELECT processing_state,state,actual_micros FROM engineering_worker_calls WHERE call_key='legacy'")).rows[0];
    assert.deepEqual(legacy, { processing_state: null, state: "settled", actual_micros: 7 });
    await db.query(`INSERT INTO engineering_worker_calls(run_id,call_key,request_hash,model,reserved_tokens,reserved_micros,rate_snapshot)
      VALUES('11111111-1111-4111-8111-111111111112','new','hash','gpt-6-luna',100,100,'{}'::jsonb)`);
    const future = (await db.query<{ processing_state: string | null }>("SELECT processing_state FROM engineering_worker_calls WHERE call_key='new'")).rows[0];
    assert.equal(future.processing_state, "reserved");
  } finally {
    await db.close();
  }
});

test("pre-claim diagnostics migration installs only a bounded SECURITY DEFINER event writer", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE medimori_engineering_worker; CREATE ROLE medimori_engineering_2c_worker; CREATE ROLE medimori_engineering_merge_executor; CREATE ROLE medimori_engineering_unrelated;");
    await db.exec("ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO medimori_engineering_merge_executor;");
    await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
    await db.exec(`CREATE TABLE engineering_worker_calls (
      run_id uuid NOT NULL, call_key text NOT NULL, request_hash text NOT NULL,
      model text NOT NULL, reserved_tokens integer NOT NULL, reserved_micros bigint NOT NULL,
      state text NOT NULL DEFAULT 'reserved', actual_input integer, actual_output integer,
      actual_micros bigint, response_id text, rate_snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,call_key), UNIQUE(response_id)
    );`);
    await db.exec(await readFile(new URL("../../../sql/engineering-preclaim-diagnostics.sql", import.meta.url), "utf8"));
    const fn = (await db.query<{ prosecdef: boolean; proconfig: string[]; worker_execute: boolean; merge_execute: boolean; unrelated_execute: boolean; group_execute: boolean; public_execute: boolean }>(`
      SELECT p.prosecdef,p.proconfig,
        has_function_privilege('medimori_engineering_2c_worker',p.oid,'EXECUTE') AS worker_execute,
        has_function_privilege('medimori_engineering_merge_executor',p.oid,'EXECUTE') AS merge_execute,
        has_function_privilege('medimori_engineering_unrelated',p.oid,'EXECUTE') AS unrelated_execute,
        has_function_privilege('medimori_engineering_worker',p.oid,'EXECUTE') AS group_execute,
        EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid='public.engineering_record_preclaim_failure(uuid,text,text)'::regprocedure`)).rows[0];
    assert.equal(fn.prosecdef, true);
    assert.ok(fn.proconfig.includes("search_path=public, pg_temp"));
    assert.equal(fn.worker_execute, true);
    assert.equal(fn.merge_execute, false);
    assert.equal(fn.unrelated_execute, false);
    assert.equal(fn.group_execute, false);
    assert.equal(fn.public_execute, false);
    const privileges = await db.query<{ table_mutation: boolean; sequence_mutation: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (
          has_table_privilege('medimori_engineering_2c_worker',c.oid,'INSERT') OR
          has_table_privilege('medimori_engineering_2c_worker',c.oid,'UPDATE') OR
          has_table_privilege('medimori_engineering_2c_worker',c.oid,'DELETE') OR
          has_table_privilege('medimori_engineering_2c_worker',c.oid,'TRUNCATE'))) AS table_mutation,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='S' AND (
            has_sequence_privilege('medimori_engineering_2c_worker',c.oid,'USAGE') OR
            has_sequence_privilege('medimori_engineering_2c_worker',c.oid,'UPDATE'))) AS sequence_mutation`);
    assert.equal(privileges.rows[0].table_mutation, false);
    assert.equal(privileges.rows[0].sequence_mutation, false);
    await db.exec("GRANT EXECUTE ON FUNCTION engineering_record_preclaim_failure(uuid,text,text) TO medimori_engineering_merge_executor;");
    await db.exec(await readFile(new URL("../../../sql/engineering-preclaim-diagnostics.sql", import.meta.url), "utf8"));
    const reapplied = await db.query<{ merge_execute: boolean; worker_execute: boolean; public_execute: boolean }>(`
      SELECT has_function_privilege('medimori_engineering_merge_executor','engineering_record_preclaim_failure(uuid,text,text)','EXECUTE') AS merge_execute,
        has_function_privilege('medimori_engineering_2c_worker','engineering_record_preclaim_failure(uuid,text,text)','EXECUTE') AS worker_execute,
        EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.engineering_record_preclaim_failure(uuid,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid='public.engineering_record_preclaim_failure(uuid,text,text)'::regprocedure`);
    assert.deepEqual(reapplied.rows[0], { merge_execute: false, worker_execute: true, public_execute: false });
  } finally {
    await db.close();
  }
});
