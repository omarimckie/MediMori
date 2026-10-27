-- Seventh engineering migration. Install after the six required migrations, in
-- order: engineering-schema.sql, engineering-worker.sql,
-- engineering-lineage.sql, engineering-initial-attempt-preparation.sql,
-- engineering-source-binding.sql, and engineering-merge.sql.
-- Add bounded pre-claim failure evidence using the existing engineering_events
-- table. This function cannot claim, lease, reserve, or change task/run state.
CREATE OR REPLACE FUNCTION engineering_record_preclaim_failure(p_run uuid,p_stage text,p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r engineering_runs%ROWTYPE; t engineering_tasks%ROWTYPE;
BEGIN
  IF session_user<>'medimori_engineering_2c_worker'
    OR current_database()<>'neondb'
    OR current_setting('neon.branch_id',true)<>'br-little-art-au7ke21s' THEN
    RAISE EXCEPTION 'preclaim_diagnostic_denied';
  END IF;
  IF NOT (
    (p_stage='configuration' AND p_code='preclaim_failure') OR
    (p_stage='scratch_preflight' AND p_code='scratch_storage_preflight_failure') OR
    (p_stage='database_identity' AND p_code='worker_identity_or_schema_failure') OR
    (p_stage='lineage_lookup' AND p_code='invalid_lineage_binding') OR
    (p_stage='target_verification' AND p_code IN ('target_unavailable','target_object_missing','target_not_ancestor')) OR
    (p_stage='target_preimage' AND p_code='target_preimage_verification_failed') OR
    (p_stage='source_export' AND p_code IN ('source_revision_mismatch','workspace_source_export_failed')) OR
    (p_stage='claim_preflight' AND p_code='preclaim_failure')
  ) THEN RAISE EXCEPTION 'preclaim_diagnostic_invalid'; END IF;

  SELECT * INTO r FROM engineering_runs WHERE id=p_run;
  IF NOT FOUND OR NOT r.worker_enabled OR r.finished_at IS NOT NULL OR r.disposition IS DISTINCT FROM 'active'
    OR r.lease_owner IS NOT NULL OR r.preflight_revision IS NOT NULL OR r.model_calls<>0 OR r.tokens<>0
    OR r.cost_usd<>0 OR r.reserved_tokens<>0 OR r.reserved_micros<>0
    OR EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=p_run)
    OR r.id IS DISTINCT FROM (SELECT latest.id FROM engineering_runs latest WHERE latest.task_id=r.task_id
      ORDER BY latest.attempt_number DESC NULLS LAST,latest.started_at DESC,latest.id DESC LIMIT 1)
    OR NOT EXISTS(SELECT 1 FROM engineering_approvals a WHERE a.task_id=r.task_id AND a.plan_version=r.plan_version
      AND a.gate='plan' AND a.decision='approved' AND a.actor NOT LIKE 'worker:%') THEN
    RAISE EXCEPTION 'preclaim_diagnostic_denied';
  END IF;
  SELECT * INTO t FROM engineering_tasks WHERE id=r.task_id;
  IF NOT FOUND OR t.status<>'implementing' OR t.version<>r.plan_version+1 THEN RAISE EXCEPTION 'preclaim_diagnostic_denied'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text||':'||p_stage||':'||p_code,0));
  IF NOT EXISTS(SELECT 1 FROM engineering_events e WHERE e.task_id=t.id AND e.action='worker_preclaim_failure'
    AND e.details->>'runId'=p_run::text AND e.details->>'stage'=p_stage AND e.details->>'code'=p_code) THEN
    INSERT INTO engineering_events(id,task_id,actor,action,details)
    VALUES(gen_random_uuid(),t.id,'worker:preclaim','worker_preclaim_failure',jsonb_build_object(
      'schemaVersion',1,'runId',p_run,'stage',p_stage,'code',p_code,'beforeClaim',true,
      'providerCouldHaveBeenReached',false,'dockerCouldHaveBeenReached',false));
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION engineering_record_preclaim_failure(uuid,text,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_worker') THEN
    REVOKE ALL ON FUNCTION engineering_record_preclaim_failure(uuid,text,text) FROM medimori_engineering_worker;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
    REVOKE ALL ON FUNCTION engineering_record_preclaim_failure(uuid,text,text) FROM medimori_engineering_merge_executor;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_2c_worker') THEN
    GRANT EXECUTE ON FUNCTION engineering_record_preclaim_failure(uuid,text,text) TO medimori_engineering_2c_worker;
  END IF;
END $$;
