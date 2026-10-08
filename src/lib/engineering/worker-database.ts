import { neon } from "@neondatabase/serverless";
import { restrictedWorkerDatabaseTarget, WorkerInitializationError } from "./worker-initialization";

type IdentityRow = {
  actor: string;
  session_actor: string;
  branch_id: string | null;
  database_name: string;
  role_exists: boolean;
  role_superuser: boolean;
  role_createdb: boolean;
  role_createrole: boolean;
  role_replication: boolean;
  role_bypassrls: boolean;
  role_member: boolean;
  task_mutation: boolean;
  approval_mutation: boolean;
  ingress_exists: boolean;
  ingress_security_definer: boolean;
  ingress_execute: boolean;
  public_execute: boolean;
  worker_call_progress_ready: boolean;
  worker_lineage_ready: boolean;
  source_binding_ready: boolean;
  source_mismatch_execute: boolean;
  source_mismatch_public_execute: boolean;
  preclaim_diagnostic_ready: boolean;
  lineage_table_access: boolean;
};

export type WorkerDatabaseIdentity = {
  branchId: string;
  database: string;
  currentUser: string;
  sessionUser: string;
  restrictedRole: true;
  callProgressReady: true;
  lineageReady: true;
  sourceBindingReady: true;
  boundedPrivileges: true;
  preclaimDiagnosticsReady: true;
};

type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export async function verifyWorkerDatabaseIdentityQuery(query: Query): Promise<WorkerDatabaseIdentity> {
  let rows: unknown[];
  try {
    rows = await query`SELECT
      current_user AS actor,
      session_user AS session_actor,
      current_setting('neon.branch_id', true) AS branch_id,
      current_database() AS database_name,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_worker') AS role_exists,
      pg_has_role(current_user,'medimori_engineering_worker','member') AS role_member,
      COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname=current_user),true) AS role_superuser,
      COALESCE((SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user),true) AS role_createdb,
      COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user),true) AS role_createrole,
      COALESCE((SELECT rolreplication FROM pg_roles WHERE rolname=current_user),true) AS role_replication,
      COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),true) AS role_bypassrls,
      (has_table_privilege(current_user,'engineering_tasks','INSERT') OR has_table_privilege(current_user,'engineering_tasks','UPDATE') OR has_table_privilege(current_user,'engineering_tasks','DELETE') OR has_table_privilege(current_user,'engineering_tasks','TRUNCATE')) AS task_mutation,
      (has_table_privilege(current_user,'engineering_approvals','INSERT') OR has_table_privilege(current_user,'engineering_approvals','UPDATE') OR has_table_privilege(current_user,'engineering_approvals','DELETE')) AS approval_mutation,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='engineering_worker' AND p.prosecdef) AS ingress_security_definer,
      has_function_privilege(current_user,'public.engineering_worker(uuid,text,text,integer,jsonb)','EXECUTE') AS ingress_execute,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE n.nspname='public' AND p.proname='engineering_worker' AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
      (NOT EXISTS(
        SELECT 1
        FROM (VALUES
          ('run_id','uuid'),('call_key','text'),('request_hash','text'),('model','text'),
          ('reserved_tokens','int4'),('reserved_micros','int8'),('state','text'),
          ('actual_input','int4'),('actual_output','int4'),('actual_micros','int8'),
          ('response_id','text'),('rate_snapshot','jsonb'),('reported_model','text'),
          ('reported_tier','text'),('created_at','timestamptz'),('processing_state','text')
        ) required(name,type_name)
        WHERE NOT EXISTS(
          SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
          WHERE a.attrelid=to_regclass('public.engineering_worker_calls')
            AND a.attname=required.name AND a.attnum>0 AND NOT a.attisdropped
            AND t.typname=required.type_name
        )
      ) AND EXISTS(
        SELECT 1 FROM pg_attribute a
        JOIN pg_type t ON t.oid=a.atttypid
        JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=to_regclass('public.engineering_worker_calls')
          AND a.attname='processing_state' AND a.attnum>0 AND NOT a.attisdropped
          AND t.typname='text' AND NOT a.attnotnull
          AND pg_get_expr(d.adbin,d.adrelid) IN ('''reserved''::text','''reserved''::character varying')
      ) AND EXISTS(
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid=to_regclass('public.engineering_worker_calls')
          AND c.conname='engineering_worker_call_processing_state'
          AND c.contype='c' AND c.convalidated
      )) AS worker_call_progress_ready,
      (to_regclass('public.engineering_run_lineage') IS NOT NULL
        AND to_regclass('public.engineering_plan_lineage') IS NOT NULL
        AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='engineering_run_lineage_valid' AND p.prosecdef
            AND p.proconfig @> ARRAY['search_path=public, pg_temp'])) AS worker_lineage_ready,
      (EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.engineering_run_lineage') AND a.attname='implementation_source_revision' AND a.attnum>0 AND NOT a.attisdropped)
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.engineering_run_lineage') AND a.attname='source_binding_version' AND a.attnum>0 AND NOT a.attisdropped)
        AND to_regclass('public.engineering_prepared_attempts') IS NOT NULL
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.engineering_prepared_attempts') AND a.attname='implementation_source_revision' AND a.attnum>0 AND NOT a.attisdropped)
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.engineering_prepared_attempts') AND a.attname='request_snapshot' AND a.attnum>0 AND NOT a.attisdropped)
        AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.engineering_run_lineage') AND c.conname='engineering_run_lineage_source_binding' AND c.contype='c' AND c.convalidated)
        AND EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=to_regclass('public.engineering_runs') AND g.tgname='engineering_run_source_binding_guard' AND NOT g.tgisinternal)
        AND to_regprocedure('public.engineering_record_source_mismatch(uuid,text)') IS NOT NULL
        AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.engineering_record_source_mismatch(uuid,text)'::regprocedure AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])) AS source_binding_ready,
      COALESCE(has_function_privilege(current_user,to_regprocedure('public.engineering_record_source_mismatch(uuid,text)'),'EXECUTE'),false) AS source_mismatch_execute,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.engineering_record_source_mismatch(uuid,text)') AND a.grantee=0 AND a.privilege_type='EXECUTE') AS source_mismatch_public_execute,
      (EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.engineering_record_preclaim_failure(uuid,text,text)') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
        AND COALESCE(has_function_privilege(current_user,to_regprocedure('public.engineering_record_preclaim_failure(uuid,text,text)'),'EXECUTE'),false)
        AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.engineering_record_preclaim_failure(uuid,text,text)') AND a.grantee=0 AND a.privilege_type='EXECUTE')) AS preclaim_diagnostic_ready,
      (COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_run_lineage'),'SELECT'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_run_lineage'),'INSERT'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_run_lineage'),'UPDATE'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_run_lineage'),'DELETE'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_plan_lineage'),'SELECT'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_plan_lineage'),'INSERT'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_plan_lineage'),'UPDATE'),false)
        OR COALESCE(has_table_privilege(current_user,to_regclass('public.engineering_plan_lineage'),'DELETE'),false)) AS lineage_table_access,
      to_regprocedure('public.engineering_worker(uuid,text,text,integer,jsonb)') IS NOT NULL AS ingress_exists`;
  } catch (error) {
    const sqlState = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^\d{5}$/.test(error.code);
    throw new WorkerInitializationError("database_identity", sqlState ? "worker_database_identity_query_failed" : "worker_database_connection_failed");
  }

  const row = rows[0] as IdentityRow | undefined;
  if (!row || typeof row !== "object") throw new WorkerInitializationError("database_identity", "worker_database_identity_query_failed");
  if (row.branch_id !== restrictedWorkerDatabaseTarget.branchId) throw new WorkerInitializationError("database_identity", "worker_database_branch_mismatch");
  if (row.actor !== restrictedWorkerDatabaseTarget.role || row.session_actor !== restrictedWorkerDatabaseTarget.role || row.database_name !== restrictedWorkerDatabaseTarget.database) {
    throw new WorkerInitializationError("database_identity", "worker_database_role_mismatch");
  }
  if (row.worker_call_progress_ready !== true || row.worker_lineage_ready !== true || row.source_binding_ready !== true || row.preclaim_diagnostic_ready !== true) throw new WorkerInitializationError("database_identity", "worker_database_schema_mismatch");
  if (row.role_superuser || row.role_createdb || row.role_createrole || row.role_replication || row.role_bypassrls || row.task_mutation || row.approval_mutation || row.lineage_table_access || !row.role_exists || !row.role_member || !row.ingress_exists || !row.ingress_security_definer || !row.ingress_execute || row.public_execute || !row.source_mismatch_execute || row.source_mismatch_public_execute) {
    throw new WorkerInitializationError("database_identity", "worker_database_identity_mismatch");
  }
  return {
    branchId: row.branch_id,
    database: row.database_name,
    currentUser: row.actor,
    sessionUser: row.session_actor,
    restrictedRole: true,
    callProgressReady: true,
    lineageReady: true,
    sourceBindingReady: true,
    boundedPrivileges: true,
    preclaimDiagnosticsReady: true,
  };
}

export async function verifyWorkerDatabaseIdentity(connection: string): Promise<WorkerDatabaseIdentity> {
  let query: Query;
  try {
    query = neon(connection) as unknown as Query;
  } catch {
    throw new WorkerInitializationError("database_identity", "worker_database_connection_failed");
  }
  return verifyWorkerDatabaseIdentityQuery(query);
}
