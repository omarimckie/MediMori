-- Post-D source approval binding. Install after engineering-initial-attempt-preparation.sql.
-- Historical rows retain NULL source values and source_binding_version=0.

ALTER TABLE engineering_run_lineage
  ADD COLUMN IF NOT EXISTS implementation_source_revision text,
  ADD COLUMN IF NOT EXISTS source_binding_version smallint NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_run_lineage'::regclass AND conname='engineering_run_lineage_source_revision') THEN
    ALTER TABLE engineering_run_lineage ADD CONSTRAINT engineering_run_lineage_source_revision
      CHECK (implementation_source_revision IS NULL OR implementation_source_revision ~ '^[a-f0-9]{40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_run_lineage'::regclass AND conname='engineering_run_lineage_source_binding') THEN
    ALTER TABLE engineering_run_lineage ADD CONSTRAINT engineering_run_lineage_source_binding
      CHECK ((source_binding_version=0 AND implementation_source_revision IS NULL)
        OR (source_binding_version=1 AND implementation_source_revision ~ '^[a-f0-9]{40}$'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION engineering_lineage_immutable_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='engineering_attempt_preparations' AND TG_OP='UPDATE'
    AND OLD.target_repository IS NULL AND OLD.target_branch IS NULL AND OLD.target_base_sha IS NULL
    AND NEW.target_repository='omarimckie/MediMori' AND NEW.target_branch='main'
    AND NEW.target_base_sha ~ '^[a-f0-9]{40}$'
    AND (to_jsonb(OLD)-ARRAY['target_repository','target_branch','target_base_sha'])=(to_jsonb(NEW)-ARRAY['target_repository','target_branch','target_base_sha']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'engineering_lineage_immutable';
END $$;

-- Replaces the legacy target-only wrapper. It remains a close-prior-attempt
-- operation; a complete P+T+S retry subject is created after the fresh plan.
CREATE OR REPLACE FUNCTION engineering_prepare_attempt_bound(
  p_task uuid,p_version integer,p_key uuid,p_actor text,p_repository text,p_branch text,p_base_sha text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_repository<>'omarimckie/MediMori' OR p_branch<>'main' OR coalesce(p_base_sha,'') !~ '^[a-f0-9]{40}$' THEN
    RETURN jsonb_build_object('ok',false,'code','target_lineage_invalid');
  END IF;
  -- The older close-attempt function checked unresolved provider activity only
  -- on unfinished runs. Reassert that guard for every newly created closure.
  IF NOT EXISTS(SELECT 1 FROM engineering_attempt_preparations p WHERE p.idempotency_key=p_key)
    AND EXISTS(SELECT 1 FROM engineering_runs r WHERE r.task_id=p_task
      AND r.id=(SELECT latest.id FROM engineering_runs latest WHERE latest.task_id=p_task ORDER BY latest.started_at DESC,latest.id DESC LIMIT 1)
      AND r.finished_at IS NOT NULL AND r.disposition IN ('blocked','cancelled','expired')
      AND (r.reserved_tokens<>0 OR r.reserved_micros<>0 OR EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=r.id AND c.state IN ('reserved','sent','uncertain')))) THEN
    RETURN jsonb_build_object('ok',false,'code','unresolved_provider_activity');
  END IF;
  result:=engineering_prepare_attempt(p_task,p_version,p_key,p_actor);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  IF result->>'replayed'='true' THEN
    IF NOT EXISTS(SELECT 1 FROM engineering_attempt_preparations p WHERE p.idempotency_key=p_key AND p.task_id=p_task AND p.actor=p_actor
      AND p.target_repository=p_repository AND p.target_branch=p_branch AND p.target_base_sha=p_base_sha) THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN result;
  END IF;
  UPDATE engineering_attempt_preparations SET target_repository=p_repository,target_branch=p_branch,target_base_sha=p_base_sha
    WHERE idempotency_key=p_key AND task_id=p_task AND actor=p_actor AND target_repository IS NULL AND target_branch IS NULL AND target_base_sha IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_target_lineage_conflict'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION engineering_prepare_retry_subject(
  p_task uuid,p_version integer,p_attempt_id uuid,p_key uuid,p_actor text,p_repository text,p_branch text,
  p_base_sha text,p_preimages jsonb,p_source_revision text
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
      OR existing.target_preimages IS DISTINCT FROM p_preimages OR existing.implementation_source_revision<>p_source_revision THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'attemptId',existing.attempt_id,'attemptNumber',existing.attempt_number,
      'planVersion',existing.plan_version,'targetRepository',existing.target_repository,'targetBranch',existing.target_branch,
      'targetBaseSha',existing.target_base_sha,'targetPreimages',existing.target_preimages,
      'implementationSourceRevision',existing.implementation_source_revision);
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
    OR coalesce(p_source_revision,'') !~ '^[a-f0-9]{40}$' OR jsonb_typeof(p_preimages)<>'object'
    OR (SELECT count(*) FROM jsonb_each(p_preimages)) NOT BETWEEN 1 AND 20
    OR EXISTS(SELECT 1 FROM jsonb_each_text(p_preimages) x WHERE x.key NOT IN (SELECT jsonb_array_elements_text(t.plan->'files')) OR x.value !~ '^[a-f0-9]{64}$')
    OR (SELECT count(*) FROM jsonb_each(p_preimages))<>(SELECT count(*) FROM jsonb_array_elements(t.plan->'files')) THEN
    RETURN jsonb_build_object('ok',false,'code','retry_subject_binding_invalid');
  END IF;
  INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,plan_version,idempotency_key,actor,request_snapshot,plan_snapshot,risk,
    target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision,previous_run_id,retry_preparation_key)
  VALUES(p_attempt_id,p_task,next_no,p_version,p_key,p_actor,t.request,t.plan,t.risk,p_repository,p_branch,p_base_sha,p_preimages,p_source_revision,retry.previous_run_id,retry.idempotency_key);
  INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
  VALUES(p_task,p_version,p_repository,p_branch,p_base_sha);
  UPDATE engineering_tasks SET status='awaiting_approval',updated_at=now() WHERE id=p_task AND version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'retry_subject_stale'; END IF;
  INSERT INTO engineering_events(id,task_id,actor,action,details)
  VALUES(gen_random_uuid(),p_task,p_actor,'prepare_retry_subject',jsonb_build_object('attemptId',p_attempt_id,'attemptNumber',next_no,
    'planVersion',p_version,'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,
    'implementationSourceRevision',p_source_revision,'preimageCount',(SELECT count(*) FROM jsonb_each(p_preimages))));
  RETURN jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'attemptNumber',next_no,'planVersion',p_version,
    'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'targetPreimages',p_preimages,
    'implementationSourceRevision',p_source_revision);
END $$;

-- Source binding version 0 is legacy/historical. Version 1 requires an exact
-- match to the immutable P+T+S preparation, for either initial or retry runs.
CREATE OR REPLACE FUNCTION engineering_run_lineage_valid(p_run uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM engineering_runs r
    JOIN engineering_tasks t ON t.id=r.task_id
    JOIN engineering_run_lineage l ON l.run_id=r.id AND l.task_id=r.task_id
      AND l.attempt_number=r.attempt_number AND l.plan_version=r.plan_version
    JOIN engineering_plan_lineage pl ON pl.task_id=l.task_id AND pl.plan_version=l.plan_version
      AND pl.target_repository=l.target_repository AND pl.target_branch=l.target_branch AND pl.target_base_sha=l.target_base_sha
    WHERE r.id=p_run AND r.attempt_number IS NOT NULL AND r.plan_snapshot IS NOT DISTINCT FROM t.plan
      AND l.target_repository='omarimckie/MediMori' AND l.target_branch='main'
      AND EXISTS(SELECT 1 FROM engineering_approvals a WHERE a.task_id=r.task_id AND a.plan_version=r.plan_version
        AND a.gate='plan' AND a.decision='approved' AND a.actor NOT LIKE 'worker:%')
      AND (
        (l.source_binding_version=1 AND EXISTS(SELECT 1 FROM engineering_prepared_attempts p
          WHERE p.attempt_id=r.id AND p.task_id=r.task_id AND p.attempt_number=r.attempt_number AND p.plan_version=r.plan_version
            AND p.request_snapshot=t.request AND p.plan_snapshot IS NOT DISTINCT FROM r.plan_snapshot AND p.risk=t.risk
            AND p.target_repository=l.target_repository AND p.target_branch=l.target_branch AND p.target_base_sha=l.target_base_sha
            AND p.implementation_source_revision=l.implementation_source_revision
            AND p.previous_run_id IS NOT DISTINCT FROM l.previous_run_id AND p.retry_preparation_key IS NOT DISTINCT FROM l.preparation_key))
        OR (l.source_binding_version=0 AND l.implementation_source_revision IS NULL AND (
          (l.attempt_number=1 AND l.previous_run_id IS NULL AND l.preparation_key IS NULL)
          OR EXISTS(SELECT 1 FROM engineering_attempt_preparations p JOIN engineering_runs previous
            ON previous.id=p.previous_run_id AND previous.task_id=p.task_id AND previous.attempt_number=p.previous_attempt_number
            WHERE p.idempotency_key=l.preparation_key AND p.task_id=l.task_id AND p.previous_run_id=l.previous_run_id
              AND p.previous_attempt_number+1=l.attempt_number AND p.target_repository=l.target_repository
              AND p.target_branch=l.target_branch AND p.target_base_sha=l.target_base_sha)))
      )
  )
$$;

-- Defense in depth: even an alternate caller of the old claim ingress cannot
-- bind an approved source revision to different exported content.
CREATE OR REPLACE FUNCTION engineering_run_source_binding_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=NEW.id AND l.source_binding_version=1)
    AND NEW.preflight_revision IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=NEW.id AND l.source_binding_version=1
      AND l.implementation_source_revision=NEW.preflight_revision
  ) THEN RAISE EXCEPTION 'approved_source_revision_mismatch'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='engineering_runs'::regclass AND tgname='engineering_run_source_binding_guard' AND NOT tgisinternal) THEN
    CREATE TRIGGER engineering_run_source_binding_guard BEFORE UPDATE OF preflight_revision ON engineering_runs
      FOR EACH ROW EXECUTE FUNCTION engineering_run_source_binding_guard();
  END IF;
END $$;

-- A pre-claim mismatch is auditable but cannot claim, lease, reserve, or rewrite S.
CREATE OR REPLACE FUNCTION engineering_record_source_mismatch(p_run uuid,p_actual_revision text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r engineering_runs%ROWTYPE; t engineering_tasks%ROWTYPE; expected_revision text; binding_version smallint;
BEGIN
  IF session_user<>'medimori_engineering_2c_worker' OR coalesce(p_actual_revision,'') !~ '^[a-f0-9]{40}$' THEN RAISE EXCEPTION 'source_mismatch_denied'; END IF;
  SELECT * INTO r FROM engineering_runs WHERE id=p_run FOR UPDATE;
  IF NOT FOUND OR NOT r.worker_enabled OR r.finished_at IS NOT NULL OR r.lease_owner IS NOT NULL
    OR r.preflight_revision IS NOT NULL OR r.model_calls<>0 OR r.tokens<>0 OR r.cost_usd<>0 OR r.reserved_tokens<>0 OR r.reserved_micros<>0
    OR EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=p_run) THEN RAISE EXCEPTION 'source_mismatch_denied'; END IF;
  SELECT implementation_source_revision,source_binding_version INTO expected_revision,binding_version FROM engineering_run_lineage WHERE run_id=p_run;
  IF binding_version<>1 OR expected_revision IS NULL OR expected_revision=p_actual_revision OR NOT engineering_run_lineage_valid(p_run) THEN RAISE EXCEPTION 'source_mismatch_denied'; END IF;
  SELECT * INTO t FROM engineering_tasks WHERE id=r.task_id FOR UPDATE;
  IF t.status<>'implementing' OR t.version<>r.plan_version+1 OR r.started_at<=now()-interval '30 minutes'
    OR r.id IS DISTINCT FROM (SELECT current_run.id FROM engineering_runs current_run WHERE current_run.task_id=t.id ORDER BY current_run.attempt_number DESC NULLS LAST,current_run.started_at DESC LIMIT 1) THEN
    RAISE EXCEPTION 'source_mismatch_denied';
  END IF;
  UPDATE engineering_runs SET finished_at=now(),disposition='blocked' WHERE id=p_run AND finished_at IS NULL;
  UPDATE engineering_tasks SET status='blocked',version=version+1,updated_at=now() WHERE id=t.id AND version=t.version;
  INSERT INTO engineering_events(id,task_id,actor,action,details)
  VALUES(gen_random_uuid(),t.id,'worker:source-binding','source_revision_mismatch',jsonb_build_object(
    'runId',p_run,'expectedSourceRevision',expected_revision,'actualSourceRevision',p_actual_revision,'beforeClaim',true));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION engineering_prepare_attempt_bound(uuid,integer,uuid,text,text,text,text) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_run_source_binding_guard() FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_record_source_mismatch(uuid,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
    REVOKE ALL ON FUNCTION engineering_prepare_retry_subject(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_record_source_mismatch(uuid,text) FROM medimori_engineering_merge_executor;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_2c_worker') THEN
    GRANT EXECUTE ON FUNCTION engineering_record_source_mismatch(uuid,text) TO medimori_engineering_2c_worker;
  END IF;
END $$;
