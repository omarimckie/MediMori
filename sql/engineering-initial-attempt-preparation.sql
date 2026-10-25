-- Additive P+T+S prepared-attempt contract for initial and retry attempts.
-- Install after engineering-lineage.sql. Preparation binds the exact plan and target before human approval, but does not
-- create a run, approval, lease, provider reservation, or worker eligibility.

CREATE TABLE IF NOT EXISTS engineering_prepared_attempts (
  attempt_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  attempt_number integer NOT NULL CHECK (attempt_number>0),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  idempotency_key uuid NOT NULL UNIQUE,
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 120),
  request_snapshot text NOT NULL CHECK (length(request_snapshot) BETWEEN 1 AND 8000),
  plan_snapshot jsonb NOT NULL,
  risk text NOT NULL,
  target_repository text NOT NULL CHECK (target_repository='omarimckie/MediMori'),
  target_branch text NOT NULL CHECK (target_branch='main'),
  target_base_sha text NOT NULL CHECK (target_base_sha ~ '^[a-f0-9]{40}$'),
  target_preimages jsonb NOT NULL CHECK (jsonb_typeof(target_preimages)='object' AND length(target_preimages::text)<=8192),
  implementation_source_revision text NOT NULL CHECK (implementation_source_revision ~ '^[a-f0-9]{40}$'),
  previous_run_id uuid REFERENCES engineering_runs(id),
  retry_preparation_key uuid REFERENCES engineering_attempt_preparations(idempotency_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,attempt_number),
  CHECK ((attempt_number=1 AND previous_run_id IS NULL AND retry_preparation_key IS NULL)
    OR (attempt_number>1 AND previous_run_id IS NOT NULL AND retry_preparation_key IS NOT NULL))
);

CREATE OR REPLACE FUNCTION engineering_prepared_attempt_immutable_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'engineering_initial_preparation_immutable';
END $$;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='engineering_prepared_attempts'::regclass AND tgname='engineering_prepared_attempt_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER engineering_prepared_attempt_immutable BEFORE UPDATE OR DELETE ON engineering_prepared_attempts
      FOR EACH ROW EXECUTE FUNCTION engineering_prepared_attempt_immutable_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION engineering_prepare_initial_attempt(
  p_task uuid,p_version integer,p_attempt_id uuid,p_key uuid,p_actor text,
  p_repository text,p_branch text,p_base_sha text,p_preimages jsonb,p_source_revision text
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
      OR existing.target_preimages IS DISTINCT FROM p_preimages OR existing.implementation_source_revision<>p_source_revision THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'attemptId',existing.attempt_id,'taskId',existing.task_id,
      'attemptNumber',existing.attempt_number,'planVersion',existing.plan_version,'targetRepository',existing.target_repository,'targetBranch',existing.target_branch,
      'targetBaseSha',existing.target_base_sha,'targetPreimages',existing.target_preimages,'implementationSourceRevision',existing.implementation_source_revision);
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
     OR coalesce(p_source_revision,'') !~ '^[a-f0-9]{40}$'
     OR jsonb_typeof(p_preimages)<>'object' OR (SELECT count(*) FROM jsonb_each(p_preimages)) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok',false,'code','target_binding_invalid');
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(p_preimages) x WHERE x.key NOT IN (SELECT jsonb_array_elements_text(t.plan->'files')) OR x.value !~ '^[a-f0-9]{64}$')
     OR (SELECT count(*) FROM jsonb_each(p_preimages))<>(SELECT count(*) FROM jsonb_array_elements(t.plan->'files')) THEN
    RETURN jsonb_build_object('ok',false,'code','target_preimages_invalid');
  END IF;
  INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,plan_version,idempotency_key,actor,request_snapshot,plan_snapshot,risk,
    target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision)
  VALUES(p_attempt_id,p_task,1,p_version,p_key,p_actor,t.request,t.plan,t.risk,p_repository,p_branch,p_base_sha,p_preimages,p_source_revision);
  INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
  VALUES(p_task,p_version,p_repository,p_branch,p_base_sha);
  -- Preparation changes lifecycle state but preserves the plan version. The
  -- human approval remains the one version increment required by worker claim.
  UPDATE engineering_tasks SET status='awaiting_approval',updated_at=now() WHERE id=p_task AND version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'initial_preparation_stale'; END IF;
  INSERT INTO engineering_events(id,task_id,actor,action,details)
  VALUES(gen_random_uuid(),p_task,p_actor,'prepare_initial_attempt',jsonb_build_object('attemptId',p_attempt_id,'attemptNumber',1,'planVersion',p_version,'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'implementationSourceRevision',p_source_revision,'preimageCount',(SELECT count(*) FROM jsonb_each(p_preimages))));
  RETURN jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'taskId',p_task,'attemptNumber',1,'planVersion',p_version,
    'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'targetPreimages',p_preimages,'implementationSourceRevision',p_source_revision);
END $$;

REVOKE ALL ON engineering_prepared_attempts FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepared_attempt_immutable_guard() FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM PUBLIC,medimori_engineering_worker;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
    REVOKE ALL ON engineering_prepared_attempts FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_prepare_initial_attempt(uuid,integer,uuid,uuid,text,text,text,text,jsonb,text) FROM medimori_engineering_merge_executor;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION engineering_run_lineage_valid(p_run uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM engineering_runs r
    JOIN engineering_tasks t ON t.id=r.task_id
    JOIN engineering_run_lineage l ON l.run_id=r.id AND l.task_id=r.task_id
      AND l.attempt_number=r.attempt_number AND l.plan_version=r.plan_version
    JOIN engineering_plan_lineage pl ON pl.task_id=l.task_id AND pl.plan_version=l.plan_version
      AND pl.target_repository=l.target_repository AND pl.target_branch=l.target_branch
      AND pl.target_base_sha=l.target_base_sha
    WHERE r.id=p_run AND r.attempt_number IS NOT NULL
      AND r.plan_snapshot IS NOT DISTINCT FROM t.plan
      AND l.target_repository='omarimckie/MediMori' AND l.target_branch='main'
      AND EXISTS (SELECT 1 FROM engineering_approvals a WHERE a.task_id=r.task_id AND a.plan_version=r.plan_version
        AND a.gate='plan' AND a.decision='approved' AND a.actor NOT LIKE 'worker:%')
      AND (
        (l.attempt_number=1 AND l.previous_run_id IS NULL AND l.preparation_key IS NULL AND (
          NOT EXISTS(SELECT 1 FROM engineering_prepared_attempts p WHERE p.task_id=r.task_id AND p.attempt_number=1)
          OR EXISTS(SELECT 1 FROM engineering_prepared_attempts p WHERE p.attempt_id=r.id AND p.task_id=r.task_id
            AND p.attempt_number=r.attempt_number AND p.plan_version=r.plan_version AND p.plan_snapshot IS NOT DISTINCT FROM r.plan_snapshot
            AND p.request_snapshot=t.request AND p.risk=t.risk AND p.target_repository=l.target_repository AND p.target_branch=l.target_branch
            AND p.target_base_sha=l.target_base_sha)
        ))
        OR EXISTS (
          SELECT 1 FROM engineering_attempt_preparations p
          JOIN engineering_runs previous ON previous.id=p.previous_run_id AND previous.task_id=p.task_id
            AND previous.attempt_number=p.previous_attempt_number
          WHERE p.idempotency_key=l.preparation_key AND p.task_id=l.task_id AND p.previous_run_id=l.previous_run_id
            AND p.previous_attempt_number+1=l.attempt_number AND p.target_repository=l.target_repository
            AND p.target_branch=l.target_branch AND p.target_base_sha=l.target_base_sha
        )
      )
  )
$$;
REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM PUBLIC,medimori_engineering_worker;
