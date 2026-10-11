-- Additive generation-aware replacement of a stale, unapproved prepared subject.
-- Install after engineering-approval-execution-separation.sql (migration nine).
-- The prepared P+T+S row remains immutable; only separate lifecycle metadata changes.
BEGIN;

ALTER TABLE engineering_prepared_attempts
  ADD COLUMN IF NOT EXISTS subject_generation smallint NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_prepared_attempts'::regclass AND conname='engineering_prepared_attempt_generation_positive') THEN
    ALTER TABLE engineering_prepared_attempts ADD CONSTRAINT engineering_prepared_attempt_generation_positive CHECK (subject_generation >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_prepared_attempts'::regclass AND conname='engineering_prepared_attempt_generation_identity') THEN
    ALTER TABLE engineering_prepared_attempts ADD CONSTRAINT engineering_prepared_attempt_generation_identity UNIQUE (attempt_id,task_id,attempt_number,subject_generation);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_prepared_attempts'::regclass AND conname='engineering_prepared_attempts_task_id_attempt_number_key') THEN
    ALTER TABLE engineering_prepared_attempts DROP CONSTRAINT engineering_prepared_attempts_task_id_attempt_number_key;
  ELSE
    RAISE EXCEPTION 'expected_prepared_attempt_logical_uniqueness_constraint_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_prepared_attempts'::regclass AND conname='engineering_prepared_attempt_task_generation') THEN
    ALTER TABLE engineering_prepared_attempts ADD CONSTRAINT engineering_prepared_attempt_task_generation UNIQUE (task_id,attempt_number,subject_generation);
  END IF;
END $$;

CREATE TABLE engineering_prepared_subject_generations (
  attempt_id uuid PRIMARY KEY,
  task_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  subject_generation smallint NOT NULL CHECK (subject_generation >= 1),
  state text NOT NULL CHECK (state IN ('active','superseded')),
  superseded_by_attempt_id uuid REFERENCES engineering_prepared_attempts(attempt_id) DEFERRABLE INITIALLY DEFERRED,
  supersedes_attempt_id uuid REFERENCES engineering_prepared_subject_generations(attempt_id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  FOREIGN KEY (attempt_id,task_id,attempt_number,subject_generation)
    REFERENCES engineering_prepared_attempts(attempt_id,task_id,attempt_number,subject_generation),
  CHECK ((state='active' AND superseded_by_attempt_id IS NULL AND superseded_at IS NULL)
      OR (state='superseded' AND superseded_by_attempt_id IS NOT NULL AND superseded_at IS NOT NULL)),
  CHECK (supersedes_attempt_id IS NULL OR supersedes_attempt_id<>attempt_id)
);
INSERT INTO engineering_prepared_subject_generations(attempt_id,task_id,attempt_number,subject_generation,state,created_at)
SELECT attempt_id,task_id,attempt_number,subject_generation,'active',created_at FROM engineering_prepared_attempts;
CREATE UNIQUE INDEX engineering_prepared_subject_one_active_per_attempt
  ON engineering_prepared_subject_generations(task_id,attempt_number) WHERE state='active';

CREATE TABLE engineering_prepared_subject_supersessions (
  idempotency_key uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  attempt_number integer NOT NULL CHECK (attempt_number=2),
  expected_task_version integer NOT NULL CHECK (expected_task_version >= 0),
  stale_attempt_id uuid NOT NULL REFERENCES engineering_prepared_subject_generations(attempt_id),
  replacement_attempt_id uuid NOT NULL UNIQUE REFERENCES engineering_prepared_subject_generations(attempt_id),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK (reason='stale_target'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stale_attempt_id<>replacement_attempt_id)
);

CREATE OR REPLACE FUNCTION engineering_prepared_subject_generation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'active' OR NEW.superseded_by_attempt_id IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'prepared_subject_generation_must_start_active';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.state='active' AND NEW.state='superseded'
    AND NEW.attempt_id=OLD.attempt_id AND NEW.task_id=OLD.task_id
    AND NEW.attempt_number=OLD.attempt_number AND NEW.subject_generation=OLD.subject_generation
    AND NEW.supersedes_attempt_id IS NOT DISTINCT FROM OLD.supersedes_attempt_id
    AND NEW.created_at=OLD.created_at AND NEW.superseded_by_attempt_id IS NOT NULL
    AND NEW.superseded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'prepared_subject_generation_immutable';
END $$;
CREATE TRIGGER engineering_prepared_subject_generation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON engineering_prepared_subject_generations
  FOR EACH ROW EXECUTE FUNCTION engineering_prepared_subject_generation_guard();

CREATE OR REPLACE FUNCTION engineering_prepared_subject_supersession_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'prepared_subject_supersession_immutable'; END $$;
CREATE TRIGGER engineering_prepared_subject_supersession_immutable
  BEFORE UPDATE OR DELETE ON engineering_prepared_subject_supersessions
  FOR EACH ROW EXECUTE FUNCTION engineering_prepared_subject_supersession_immutable();

CREATE OR REPLACE FUNCTION engineering_prepared_subject_generation_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE predecessor uuid;
BEGIN
  IF NEW.subject_generation>1 THEN
    SELECT attempt_id INTO predecessor FROM engineering_prepared_subject_generations
      WHERE task_id=NEW.task_id AND attempt_number=NEW.attempt_number AND subject_generation=NEW.subject_generation-1
        AND state='superseded' AND superseded_by_attempt_id=NEW.attempt_id;
    IF predecessor IS NULL THEN RAISE EXCEPTION 'prepared_subject_generation_predecessor_missing'; END IF;
  END IF;
  INSERT INTO engineering_prepared_subject_generations(attempt_id,task_id,attempt_number,subject_generation,state,supersedes_attempt_id,created_at)
  VALUES(NEW.attempt_id,NEW.task_id,NEW.attempt_number,NEW.subject_generation,'active',predecessor,NEW.created_at);
  RETURN NEW;
END $$;
CREATE TRIGGER engineering_prepared_subject_generation_after_insert
  AFTER INSERT ON engineering_prepared_attempts
  FOR EACH ROW EXECUTE FUNCTION engineering_prepared_subject_generation_insert();

CREATE OR REPLACE FUNCTION engineering_prepared_subject_approval_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.prepared_attempt_id IS NOT NULL AND NEW.gate='plan' THEN
    PERFORM 1 FROM engineering_tasks WHERE id=NEW.task_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM engineering_prepared_attempts p
      JOIN engineering_prepared_subject_generations g ON g.attempt_id=p.attempt_id AND g.task_id=p.task_id
        AND g.attempt_number=p.attempt_number AND g.subject_generation=p.subject_generation AND g.state='active'
      WHERE p.attempt_id=NEW.prepared_attempt_id AND p.task_id=NEW.task_id AND p.plan_version=NEW.plan_version) THEN
      RAISE EXCEPTION 'approval_requires_active_prepared_subject';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER engineering_prepared_subject_approval_guard
  BEFORE INSERT OR UPDATE OF prepared_attempt_id,task_id,plan_version,gate ON engineering_approvals
  FOR EACH ROW EXECUTE FUNCTION engineering_prepared_subject_approval_guard();

CREATE OR REPLACE FUNCTION engineering_prepare_subject_supersession(
  p_task uuid,p_expected_version integer,p_stale_attempt_id uuid,p_replacement_attempt_id uuid,p_key uuid,p_actor text,
  p_repository text,p_branch text,p_base_sha text,p_preimages jsonb,p_source_revision text,p_source_policy_version smallint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t engineering_tasks%ROWTYPE; old engineering_prepared_attempts%ROWTYPE; retry engineering_attempt_preparations%ROWTYPE;
        prior engineering_prepared_subject_supersessions%ROWTYPE; next_version integer;
BEGIN
  IF p_task IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_stale_attempt_id IS NULL
    OR p_replacement_attempt_id IS NULL OR p_replacement_attempt_id=p_stale_attempt_id OR p_key IS NULL
    OR coalesce(p_actor,'') !~ '^[^[:cntrl:]]{1,120}$' OR p_actor LIKE 'worker:%'
    OR p_repository<>'omarimckie/MediMori' OR p_branch<>'main'
    OR coalesce(p_base_sha,'') !~ '^[a-f0-9]{40}$' OR coalesce(p_source_revision,'') !~ '^[a-f0-9]{40}$'
    OR p_source_policy_version IS DISTINCT FROM 2 OR jsonb_typeof(p_preimages)<>'object'
    OR (SELECT count(*) FROM jsonb_each(p_preimages))<>1
    OR NOT (p_preimages ? 'README.md') OR (p_preimages->>'README.md') !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('ok',false,'code','supersession_binding_invalid');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  SELECT * INTO prior FROM engineering_prepared_subject_supersessions WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF prior.task_id<>p_task OR prior.expected_task_version<>p_expected_version
      OR prior.stale_attempt_id<>p_stale_attempt_id OR prior.actor<>p_actor THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN (SELECT jsonb_build_object('ok',true,'replayed',true,'attemptId',p.attempt_id,'attemptNumber',p.attempt_number,
      'planVersion',p.plan_version,'subjectGeneration',p.subject_generation,'targetRepository',p.target_repository,
      'targetBranch',p.target_branch,'targetBaseSha',p.target_base_sha,'implementationSourceRevision',p.implementation_source_revision,
      'sourceSelectionPolicyVersion',p.source_selection_policy_version)
      FROM engineering_prepared_attempts p WHERE p.attempt_id=prior.replacement_attempt_id);
  END IF;

  SELECT * INTO t FROM engineering_tasks WHERE id=p_task FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','task_missing'); END IF;
  IF t.version<>p_expected_version THEN RETURN jsonb_build_object('ok',false,'code','stale_version'); END IF;
  IF t.status<>'awaiting_approval' OR t.plan IS NULL OR t.risk IS DISTINCT FROM 'low'
    OR coalesce(t.plan->'files','null'::jsonb)<>'["README.md"]'::jsonb
    OR coalesce(t.plan->'operations','null'::jsonb)<>'[]'::jsonb
    OR jsonb_typeof(t.plan->'validations')<>'array' OR jsonb_array_length(t.plan->'validations')<>6
    OR NOT ((t.plan->'validations') ?& ARRAY['test','lint','typecheck','build','security:check','test:engineering']) THEN
    RETURN jsonb_build_object('ok',false,'code','task_plan_not_eligible');
  END IF;
  SELECT * INTO old FROM engineering_prepared_attempts WHERE attempt_id=p_stale_attempt_id AND task_id=p_task;
  IF NOT FOUND OR old.attempt_number<>2 OR old.subject_generation<>1 OR old.plan_version<>p_expected_version
    OR old.request_snapshot IS DISTINCT FROM t.request OR old.plan_snapshot IS DISTINCT FROM t.plan OR old.risk IS DISTINCT FROM t.risk
    OR old.source_selection_policy_version<>2 THEN
    RETURN jsonb_build_object('ok',false,'code','stale_subject_mismatch');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM engineering_prepared_subject_generations g
    WHERE g.attempt_id=old.attempt_id AND g.task_id=p_task AND g.attempt_number=2 AND g.subject_generation=1 AND g.state='active')
    OR EXISTS(SELECT 1 FROM engineering_approvals a WHERE a.prepared_attempt_id=old.attempt_id AND a.gate='plan') THEN
    RETURN jsonb_build_object('ok',false,'code','subject_not_supersedable');
  END IF;
  SELECT * INTO retry FROM engineering_attempt_preparations WHERE task_id=p_task ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR retry.previous_attempt_number<>1 OR retry.previous_disposition<>'expired'
    OR old.previous_run_id IS DISTINCT FROM retry.previous_run_id OR old.retry_preparation_key IS DISTINCT FROM retry.idempotency_key THEN
    RETURN jsonb_build_object('ok',false,'code','retry_lineage_mismatch');
  END IF;
  IF EXISTS(SELECT 1 FROM engineering_runs r WHERE r.task_id=p_task AND r.attempt_number=2)
    OR EXISTS(SELECT 1 FROM engineering_worker_calls c JOIN engineering_runs r ON r.id=c.run_id WHERE r.task_id=p_task AND r.attempt_number=2)
    OR EXISTS(SELECT 1 FROM engineering_costs c JOIN engineering_runs r ON r.id=c.run_id WHERE r.task_id=p_task AND r.attempt_number=2)
    OR EXISTS(SELECT 1 FROM engineering_validations v JOIN engineering_runs r ON r.id=v.run_id WHERE r.task_id=p_task AND r.attempt_number=2)
    OR EXISTS(SELECT 1 FROM engineering_events e WHERE e.task_id=p_task AND e.details->>'preparedAttemptId'=p_stale_attempt_id::text
      AND e.action IN ('execution_authorized','worker_claimed','proposal_evidence','validation_progress','validation_completed')) THEN
    RETURN jsonb_build_object('ok',false,'code','execution_activity_exists');
  END IF;
  IF old.target_repository<>'omarimckie/MediMori' OR old.target_branch<>'main'
    OR old.target_base_sha=p_base_sha THEN
    RETURN jsonb_build_object('ok',false,'code','target_is_not_stale');
  END IF;
  IF p_replacement_attempt_id IN (SELECT attempt_id FROM engineering_prepared_attempts)
    OR EXISTS(SELECT 1 FROM engineering_prepared_attempts WHERE idempotency_key=p_key) THEN
    RETURN jsonb_build_object('ok',false,'code','replacement_identity_conflict');
  END IF;
  next_version:=p_expected_version+1;
  UPDATE engineering_prepared_subject_generations SET state='superseded',superseded_by_attempt_id=p_replacement_attempt_id,superseded_at=now()
    WHERE attempt_id=old.attempt_id AND state='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','subject_not_active'); END IF;
  INSERT INTO engineering_prepared_attempts(attempt_id,task_id,attempt_number,subject_generation,plan_version,idempotency_key,actor,
    request_snapshot,plan_snapshot,risk,target_repository,target_branch,target_base_sha,target_preimages,implementation_source_revision,
    source_selection_policy_version,previous_run_id,retry_preparation_key)
  VALUES(p_replacement_attempt_id,p_task,2,2,next_version,p_key,p_actor,t.request,t.plan,t.risk,p_repository,p_branch,p_base_sha,p_preimages,
    p_source_revision,p_source_policy_version,old.previous_run_id,old.retry_preparation_key);
  INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
    VALUES(p_task,next_version,p_repository,p_branch,p_base_sha);
  UPDATE engineering_tasks SET version=next_version,status='awaiting_approval',updated_at=now()
    WHERE id=p_task AND version=p_expected_version AND status='awaiting_approval';
  IF NOT FOUND THEN RAISE EXCEPTION 'prepared_subject_supersession_task_race'; END IF;
  INSERT INTO engineering_prepared_subject_supersessions(idempotency_key,task_id,attempt_number,expected_task_version,stale_attempt_id,replacement_attempt_id,actor,reason)
    VALUES(p_key,p_task,2,p_expected_version,old.attempt_id,p_replacement_attempt_id,p_actor,'stale_target');
  INSERT INTO engineering_events(id,task_id,actor,action,details)
    VALUES(gen_random_uuid(),p_task,p_actor,'prepared_subject_superseded',jsonb_build_object('staleAttemptId',old.attempt_id,
      'replacementAttemptId',p_replacement_attempt_id,'attemptNumber',2,'fromGeneration',1,'toGeneration',2,
      'fromPlanVersion',p_expected_version,'toPlanVersion',next_version,'reason','stale_target','targetBaseSha',p_base_sha,
      'sourceSelectionPolicyVersion',p_source_policy_version));
  RETURN jsonb_build_object('ok',true,'replayed',false,'attemptId',p_replacement_attempt_id,'attemptNumber',2,
    'subjectGeneration',2,'planVersion',next_version,'targetRepository',p_repository,'targetBranch',p_branch,
    'targetBaseSha',p_base_sha,'targetPreimages',p_preimages,'implementationSourceRevision',p_source_revision,
    'sourceSelectionPolicyVersion',p_source_policy_version);
END $$;

-- Retry-key replays must resolve only an active generation. The prior version
-- remains available in the existing migration for databases before this rollout.
CREATE OR REPLACE FUNCTION engineering_prepare_retry_subject_v2(
  p_task uuid,p_version integer,p_attempt_id uuid,p_key uuid,p_actor text,p_repository text,p_branch text,
  p_base_sha text,p_preimages jsonb,p_source_revision text,p_source_policy_version smallint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t engineering_tasks%ROWTYPE; retry engineering_attempt_preparations%ROWTYPE; existing engineering_prepared_attempts%ROWTYPE; next_no integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  SELECT p.* INTO existing FROM engineering_prepared_attempts p
    JOIN engineering_prepared_subject_generations g ON g.attempt_id=p.attempt_id AND g.state='active'
    WHERE p.idempotency_key=p_key;
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
      'implementationSourceRevision',existing.implementation_source_revision,'sourceSelectionPolicyVersion',existing.source_selection_policy_version,
      'subjectGeneration',existing.subject_generation);
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
  RETURN jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'attemptNumber',next_no,'subjectGeneration',1,'planVersion',p_version,
    'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'targetPreimages',p_preimages,
    'implementationSourceRevision',p_source_revision,'sourceSelectionPolicyVersion',p_source_policy_version);
END $$;

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
        AND a.gate='plan' AND a.decision='approved' AND a.actor NOT LIKE 'worker:%'
        AND ((l.source_binding_version=1 AND l.source_selection_policy_version=2 AND a.prepared_attempt_id=r.id)
          OR (NOT (l.source_binding_version=1 AND l.source_selection_policy_version=2) AND a.prepared_attempt_id IS NULL)))
      AND (
        (l.source_binding_version=1 AND EXISTS(SELECT 1 FROM engineering_prepared_attempts p
          JOIN engineering_prepared_subject_generations g ON g.attempt_id=p.attempt_id AND g.task_id=p.task_id
            AND g.attempt_number=p.attempt_number AND g.subject_generation=p.subject_generation AND g.state='active'
          WHERE p.attempt_id=r.id AND p.task_id=r.task_id AND p.attempt_number=r.attempt_number AND p.plan_version=r.plan_version
            AND p.request_snapshot=t.request AND p.plan_snapshot IS NOT DISTINCT FROM r.plan_snapshot AND p.risk=t.risk
            AND p.target_repository=l.target_repository AND p.target_branch=l.target_branch AND p.target_base_sha=l.target_base_sha
            AND p.implementation_source_revision=l.implementation_source_revision
            AND p.source_selection_policy_version=l.source_selection_policy_version
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

REVOKE ALL ON engineering_prepared_subject_generations,engineering_prepared_subject_supersessions FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_prepared_subject_generation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_prepared_subject_generation_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_prepared_subject_supersession_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_prepared_subject_approval_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_worker') THEN
    REVOKE ALL ON engineering_prepared_subject_generations,engineering_prepared_subject_supersessions FROM medimori_engineering_worker;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_generation_guard() FROM medimori_engineering_worker;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_generation_insert() FROM medimori_engineering_worker;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_supersession_immutable() FROM medimori_engineering_worker;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_approval_guard() FROM medimori_engineering_worker;
    REVOKE ALL ON FUNCTION engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM medimori_engineering_worker;
    REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM medimori_engineering_worker;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_2c_worker') THEN
    REVOKE ALL ON FUNCTION engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM medimori_engineering_2c_worker;
    REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM medimori_engineering_2c_worker;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
    REVOKE ALL ON engineering_prepared_subject_generations,engineering_prepared_subject_supersessions FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_generation_guard() FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_generation_insert() FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_supersession_immutable() FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_prepared_subject_approval_guard() FROM medimori_engineering_merge_executor;
    REVOKE ALL ON FUNCTION engineering_prepare_subject_supersession(uuid,integer,uuid,uuid,uuid,text,text,text,text,jsonb,text,smallint) FROM medimori_engineering_merge_executor;
  END IF;
END $$;
COMMIT;
