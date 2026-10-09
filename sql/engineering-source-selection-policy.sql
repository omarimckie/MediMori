-- Additive source-selection policy binding. Install after engineering-source-binding.sql.
-- Historical prepared/run lineage rows retain policy version 0; new preparations must explicitly bind version 2.
ALTER TABLE engineering_prepared_attempts ADD COLUMN IF NOT EXISTS source_selection_policy_version smallint NOT NULL DEFAULT 0;
ALTER TABLE engineering_run_lineage ADD COLUMN IF NOT EXISTS source_selection_policy_version smallint NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_prepared_attempts'::regclass AND conname='engineering_prepared_attempt_source_policy') THEN
    ALTER TABLE engineering_prepared_attempts ADD CONSTRAINT engineering_prepared_attempt_source_policy CHECK(source_selection_policy_version IN (0,2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_run_lineage'::regclass AND conname='engineering_run_lineage_source_policy') THEN
    ALTER TABLE engineering_run_lineage ADD CONSTRAINT engineering_run_lineage_source_policy CHECK(source_selection_policy_version IN (0,2));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION engineering_prepare_initial_attempt_v2(
  p_task uuid,p_version integer,p_attempt_id uuid,p_key uuid,p_actor text,
  p_repository text,p_branch text,p_base_sha text,p_preimages jsonb,p_source_revision text,p_source_policy_version smallint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t engineering_tasks%ROWTYPE; existing engineering_prepared_attempts%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_key::text));
  SELECT * INTO existing FROM engineering_prepared_attempts WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF existing.task_id<>p_task OR existing.attempt_number<>1 OR existing.actor<>p_actor OR existing.plan_version<>p_version
      OR existing.request_snapshot IS DISTINCT FROM (SELECT request FROM engineering_tasks WHERE id=p_task)
      OR existing.plan_snapshot IS DISTINCT FROM (SELECT plan FROM engineering_tasks WHERE id=p_task)
      OR existing.risk IS DISTINCT FROM (SELECT risk FROM engineering_tasks WHERE id=p_task)
      OR existing.target_repository<>p_repository OR existing.target_branch<>p_branch OR existing.target_base_sha<>p_base_sha
      OR existing.target_preimages IS DISTINCT FROM p_preimages OR existing.implementation_source_revision<>p_source_revision
      OR existing.source_selection_policy_version<>p_source_policy_version THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'attemptId',existing.attempt_id,'taskId',existing.task_id,
      'attemptNumber',existing.attempt_number,'planVersion',existing.plan_version,'targetRepository',existing.target_repository,'targetBranch',existing.target_branch,
      'targetBaseSha',existing.target_base_sha,'targetPreimages',existing.target_preimages,'implementationSourceRevision',existing.implementation_source_revision,'sourceSelectionPolicyVersion',existing.source_selection_policy_version);
  END IF;
  SELECT * INTO t FROM engineering_tasks WHERE id=p_task FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','task_missing'); END IF;
  IF t.version<>p_version THEN RETURN jsonb_build_object('ok',false,'code','stale_version'); END IF;
  IF EXISTS(SELECT 1 FROM engineering_prepared_attempts WHERE task_id=p_task) THEN
    RETURN jsonb_build_object('ok',false,'code','initial_attempt_already_prepared');
  END IF;
  IF t.status NOT IN ('planned','awaiting_approval') OR t.plan IS NULL OR t.risk IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','task_not_preparable');
  END IF;
  IF EXISTS(SELECT 1 FROM engineering_runs WHERE task_id=p_task)
     OR EXISTS(SELECT 1 FROM engineering_approvals WHERE task_id=p_task AND gate='plan' AND decision='approved') THEN
    RETURN jsonb_build_object('ok',false,'code','initial_attempt_not_available');
  END IF;
  IF p_repository<>'omarimckie/MediMori' OR p_branch<>'main' OR coalesce(p_base_sha,'') !~ '^[a-f0-9]{40}$'
     OR coalesce(p_source_revision,'') !~ '^[a-f0-9]{40}$' OR p_source_policy_version IS DISTINCT FROM 2
     OR jsonb_typeof(p_preimages)<>'object' OR (SELECT count(*) FROM jsonb_each(p_preimages)) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok',false,'code','target_binding_invalid');
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(p_preimages) x WHERE x.key NOT IN (SELECT jsonb_array_elements_text(t.plan->'files')) OR x.value !~ '^[a-f0-9]{64}$')
     OR (SELECT count(*) FROM jsonb_each(p_preimages))<>(SELECT count(*) FROM jsonb_array_elements(t.plan->'files')) THEN
    RETURN jsonb_build_object('ok',false,'code','target_preimages_invalid');
  END IF;
  INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,plan_version,idempotency_key,actor,request_snapshot,plan_snapshot,risk,
    target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision,source_selection_policy_version)
  VALUES(p_attempt_id,p_task,1,p_version,p_key,p_actor,t.request,t.plan,t.risk,p_repository,p_branch,p_base_sha,p_preimages,p_source_revision,p_source_policy_version);
  INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
  VALUES(p_task,p_version,p_repository,p_branch,p_base_sha);
  -- Preparation changes lifecycle state but preserves the plan version. The
  -- human approval remains the one version increment required by worker claim.
  UPDATE engineering_tasks SET status='awaiting_approval',updated_at=now() WHERE id=p_task AND version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'initial_preparation_stale'; END IF;
  INSERT INTO engineering_events(id,task_id,actor,action,details)
  VALUES(gen_random_uuid(),p_task,p_actor,'prepare_initial_attempt',jsonb_build_object('attemptId',p_attempt_id,'attemptNumber',1,'planVersion',p_version,'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'implementationSourceRevision',p_source_revision,'sourceSelectionPolicyVersion',p_source_policy_version,'preimageCount',(SELECT count(*) FROM jsonb_each(p_preimages))));
  RETURN jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'taskId',p_task,'attemptNumber',1,'planVersion',p_version,
    'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'targetPreimages',p_preimages,'implementationSourceRevision',p_source_revision,'sourceSelectionPolicyVersion',p_source_policy_version);
END $$;

CREATE OR REPLACE FUNCTION engineering_prepare_retry_subject_v2(
  p_task uuid,p_version integer,p_attempt_id uuid,p_key uuid,p_actor text,p_repository text,p_branch text,
  p_base_sha text,p_preimages jsonb,p_source_revision text,p_source_policy_version smallint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t engineering_tasks%ROWTYPE; retry engineering_attempt_preparations%ROWTYPE; existing engineering_prepared_attempts%ROWTYPE; next_no integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  SELECT * INTO existing FROM engineering_prepared_attempts WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF existing.task_id<>p_task OR existing.actor<>p_actor OR existing.plan_version<>p_version
      OR existing.attempt_number<>(SELECT previous_attempt_number+1 FROM engineering_attempt_preparations WHERE task_id=p_task ORDER BY created_at DESC LIMIT 1)
      OR existing.request_snapshot IS DISTINCT FROM (SELECT request FROM engineering_tasks WHERE id=p_task)
      OR existing.plan_snapshot IS DISTINCT FROM (SELECT plan FROM engineering_tasks WHERE id=p_task)
      OR existing.risk IS DISTINCT FROM (SELECT risk FROM engineering_tasks WHERE id=p_task)
      OR existing.previous_run_id IS DISTINCT FROM (SELECT previous_run_id FROM engineering_attempt_preparations WHERE task_id=p_task ORDER BY created_at DESC LIMIT 1)
      OR existing.retry_preparation_key IS DISTINCT FROM (SELECT idempotency_key FROM engineering_attempt_preparations WHERE task_id=p_task ORDER BY created_at DESC LIMIT 1)
      OR existing.target_repository<>p_repository OR existing.target_branch<>p_branch OR existing.target_base_sha<>p_base_sha
      OR existing.target_preimages IS DISTINCT FROM p_preimages OR existing.implementation_source_revision<>p_source_revision
      OR existing.source_selection_policy_version<>p_source_policy_version THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'attemptId',existing.attempt_id,'attemptNumber',existing.attempt_number,
      'planVersion',existing.plan_version,'targetRepository',existing.target_repository,'targetBranch',existing.target_branch,
      'targetBaseSha',existing.target_base_sha,'targetPreimages',existing.target_preimages,
      'implementationSourceRevision',existing.implementation_source_revision,'sourceSelectionPolicyVersion',existing.source_selection_policy_version);
  END IF;
  SELECT * INTO t FROM engineering_tasks WHERE id=p_task FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','task_missing'); END IF;
  IF t.version<>p_version THEN RETURN jsonb_build_object('ok',false,'code','stale_version'); END IF;
  IF t.status<>'planned' OR t.plan IS NULL OR t.risk IS NULL THEN RETURN jsonb_build_object('ok',false,'code','task_not_preparable'); END IF;
  SELECT * INTO retry FROM engineering_attempt_preparations WHERE task_id=p_task ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR retry.to_version>=p_version THEN RETURN jsonb_build_object('ok',false,'code','retry_preparation_missing'); END IF;
  IF retry.previous_disposition NOT IN ('blocked','cancelled','expired') OR NOT EXISTS(
    SELECT 1 FROM engineering_runs previous JOIN engineering_approvals a
      ON a.task_id=previous.task_id AND a.plan_version=previous.plan_version AND a.gate='plan' AND a.decision='approved' AND a.actor NOT LIKE 'worker:%'
    WHERE previous.id=retry.previous_run_id AND previous.task_id=p_task AND previous.attempt_number=retry.previous_attempt_number
      AND previous.finished_at IS NOT NULL AND previous.disposition=retry.previous_disposition
      AND previous.id=(SELECT latest.id FROM engineering_runs latest WHERE latest.task_id=p_task ORDER BY latest.attempt_number DESC NULLS LAST,latest.started_at DESC LIMIT 1)
      AND previous.reserved_tokens=0 AND previous.reserved_micros=0
      AND NOT EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=previous.id AND c.state IN ('reserved','sent','uncertain'))
  ) THEN RETURN jsonb_build_object('ok',false,'code','prior_attempt_not_closed'); END IF;
  next_no:=retry.previous_attempt_number+1;
  IF EXISTS(SELECT 1 FROM engineering_prepared_attempts WHERE task_id=p_task AND attempt_number=next_no) THEN
    RETURN jsonb_build_object('ok',false,'code','retry_subject_already_prepared');
  END IF;
  IF p_repository<>'omarimckie/MediMori' OR p_branch<>'main' OR coalesce(p_base_sha,'') !~ '^[a-f0-9]{40}$'
    OR coalesce(p_source_revision,'') !~ '^[a-f0-9]{40}$' OR p_source_policy_version IS DISTINCT FROM 2 OR jsonb_typeof(p_preimages)<>'object'
    OR (SELECT count(*) FROM jsonb_each(p_preimages)) NOT BETWEEN 1 AND 20
    OR EXISTS(SELECT 1 FROM jsonb_each_text(p_preimages) x WHERE x.key NOT IN (SELECT jsonb_array_elements_text(t.plan->'files')) OR x.value !~ '^[a-f0-9]{64}$')
    OR (SELECT count(*) FROM jsonb_each(p_preimages))<>(SELECT count(*) FROM jsonb_array_elements(t.plan->'files')) THEN
    RETURN jsonb_build_object('ok',false,'code','retry_subject_binding_invalid');
  END IF;
  INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,plan_version,idempotency_key,actor,request_snapshot,plan_snapshot,risk,
    target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision,source_selection_policy_version,previous_run_id,retry_preparation_key)
  VALUES(p_attempt_id,p_task,next_no,p_version,p_key,p_actor,t.request,t.plan,t.risk,p_repository,p_branch,p_base_sha,p_preimages,p_source_revision,p_source_policy_version,retry.previous_run_id,retry.idempotency_key);
  INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
  VALUES(p_task,p_version,p_repository,p_branch,p_base_sha);
  UPDATE engineering_tasks SET status='awaiting_approval',updated_at=now() WHERE id=p_task AND version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'retry_subject_stale'; END IF;
  INSERT INTO engineering_events(id,task_id,actor,action,details)
  VALUES(gen_random_uuid(),p_task,p_actor,'prepare_retry_subject',jsonb_build_object('attemptId',p_attempt_id,'attemptNumber',next_no,
    'planVersion',p_version,'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,
    'implementationSourceRevision',p_source_revision,'sourceSelectionPolicyVersion',p_source_policy_version,'preimageCount',(SELECT count(*) FROM jsonb_each(p_preimages))));
  RETURN jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'attemptNumber',next_no,'planVersion',p_version,
    'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'targetPreimages',p_preimages,
    'implementationSourceRevision',p_source_revision,'sourceSelectionPolicyVersion',p_source_policy_version);
END $$;

-- These invoker functions are available only to the control-plane DB owner. The legacy APIs
-- remain readable for historical evidence, but their default policy-0 rows cannot execute.
REVOKE ALL ON FUNCTION engineering_prepare_initial_attempt_v2(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepare_retry_subject_v2(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM PUBLIC,medimori_engineering_worker;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
  REVOKE ALL ON FUNCTION engineering_prepare_initial_attempt_v2(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM medimori_engineering_merge_executor;
  REVOKE ALL ON FUNCTION engineering_prepare_retry_subject_v2(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM medimori_engineering_merge_executor;
  REVOKE ALL ON FUNCTION engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM medimori_engineering_merge_executor;
  REVOKE ALL ON FUNCTION engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM medimori_engineering_merge_executor;
 END IF;
END $$;

-- Only a current source-policy-v2 lineage may bind preflight S. This guard keeps
-- historical lineage readable without granting old subjects worker eligibility.
CREATE OR REPLACE FUNCTION engineering_run_source_binding_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.preflight_revision IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=NEW.id
      AND l.source_binding_version=1 AND l.source_selection_policy_version=2
      AND l.implementation_source_revision=NEW.preflight_revision
  ) THEN RAISE EXCEPTION 'approved_source_policy_or_revision_mismatch'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION engineering_run_source_binding_guard() FROM PUBLIC,medimori_engineering_worker;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_2c_worker') THEN
  GRANT EXECUTE ON FUNCTION engineering_record_source_mismatch(uuid,text) TO medimori_engineering_2c_worker;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION engineering_record_source_mismatch(p_run uuid,p_actual_revision text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r engineering_runs%ROWTYPE; t engineering_tasks%ROWTYPE; expected_revision text; binding_version smallint; policy_version smallint;
BEGIN
 IF session_user<>'medimori_engineering_2c_worker' OR coalesce(p_actual_revision,'') !~ '^[a-f0-9]{40}$' THEN RAISE EXCEPTION 'source_mismatch_denied'; END IF;
 SELECT * INTO r FROM engineering_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR NOT r.worker_enabled OR r.finished_at IS NOT NULL OR r.lease_owner IS NOT NULL
   OR r.preflight_revision IS NOT NULL OR r.model_calls<>0 OR r.tokens<>0 OR r.cost_usd<>0 OR r.reserved_tokens<>0 OR r.reserved_micros<>0
   OR EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=p_run) THEN RAISE EXCEPTION 'source_mismatch_denied'; END IF;
 SELECT implementation_source_revision,source_binding_version,source_selection_policy_version INTO expected_revision,binding_version,policy_version FROM engineering_run_lineage WHERE run_id=p_run;
 IF binding_version<>1 OR policy_version<>2 OR expected_revision IS NULL OR expected_revision=p_actual_revision OR NOT engineering_run_lineage_valid(p_run) THEN RAISE EXCEPTION 'source_mismatch_denied'; END IF;
 SELECT * INTO t FROM engineering_tasks WHERE id=r.task_id FOR UPDATE;
 IF t.status<>'implementing' OR t.version<>r.plan_version+1 OR r.started_at<=now()-interval '30 minutes'
   OR r.id IS DISTINCT FROM (SELECT current_run.id FROM engineering_runs current_run WHERE current_run.task_id=t.id ORDER BY current_run.attempt_number DESC NULLS LAST,current_run.started_at DESC LIMIT 1) THEN
   RAISE EXCEPTION 'source_mismatch_denied';
 END IF;
 UPDATE engineering_runs SET finished_at=now(),disposition='blocked' WHERE id=p_run AND finished_at IS NULL;
 UPDATE engineering_tasks SET status='blocked',version=version+1,updated_at=now() WHERE id=t.id AND version=t.version;
 INSERT INTO engineering_events(id,task_id,actor,action,details)
 VALUES(gen_random_uuid(),t.id,'worker:source-binding','source_revision_mismatch',jsonb_build_object('runId',p_run,'expectedSourceRevision',expected_revision,'actualSourceRevision',p_actual_revision,'beforeClaim',true));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION engineering_record_source_mismatch(uuid,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
  REVOKE ALL ON FUNCTION engineering_record_source_mismatch(uuid,text) FROM medimori_engineering_merge_executor;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_2c_worker') THEN
  GRANT EXECUTE ON FUNCTION engineering_record_source_mismatch(uuid,text) TO medimori_engineering_2c_worker;
 END IF;
END $$;
