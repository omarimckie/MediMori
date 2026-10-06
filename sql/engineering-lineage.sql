-- Group C additive worker lineage contract. Install after engineering-worker.sql.
-- This migration is prepared for review only; it is not applied automatically.

ALTER TABLE engineering_attempt_preparations
  ADD COLUMN IF NOT EXISTS target_repository text,
  ADD COLUMN IF NOT EXISTS target_branch text,
  ADD COLUMN IF NOT EXISTS target_base_sha text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_attempt_preparations'::regclass AND conname='engineering_attempt_preparation_target_sha') THEN
    ALTER TABLE engineering_attempt_preparations ADD CONSTRAINT engineering_attempt_preparation_target_sha
      CHECK (target_base_sha IS NULL OR target_base_sha ~ '^[a-f0-9]{40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_attempt_preparations'::regclass AND conname='engineering_attempt_preparation_target_policy') THEN
    ALTER TABLE engineering_attempt_preparations ADD CONSTRAINT engineering_attempt_preparation_target_policy
      CHECK ((target_repository IS NULL AND target_branch IS NULL) OR (target_repository='omarimckie/MediMori' AND target_branch='main'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS engineering_run_lineage (
  run_id uuid PRIMARY KEY REFERENCES engineering_runs(id),
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  target_repository text NOT NULL CHECK (target_repository='omarimckie/MediMori'),
  target_branch text NOT NULL CHECK (target_branch='main'),
  target_base_sha text NOT NULL CHECK (target_base_sha ~ '^[a-f0-9]{40}$'),
  previous_run_id uuid REFERENCES engineering_runs(id),
  preparation_key uuid REFERENCES engineering_attempt_preparations(idempotency_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,attempt_number),
  CHECK ((attempt_number=1 AND previous_run_id IS NULL AND preparation_key IS NULL)
      OR (attempt_number>1 AND previous_run_id IS NOT NULL AND preparation_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS engineering_run_lineage_task ON engineering_run_lineage(task_id,attempt_number);

CREATE TABLE IF NOT EXISTS engineering_plan_lineage (
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  target_repository text NOT NULL CHECK (target_repository='omarimckie/MediMori'),
  target_branch text NOT NULL CHECK (target_branch='main'),
  target_base_sha text NOT NULL CHECK (target_base_sha ~ '^[a-f0-9]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,plan_version)
);

-- The legacy preparation API cannot safely establish a target lineage. New
-- server code must use this wrapper; its call to the existing lifecycle and
-- lineage write are atomic in the surrounding database transaction.
CREATE OR REPLACE FUNCTION engineering_prepare_attempt_bound(
  p_task uuid,p_version integer,p_key uuid,p_actor text,p_repository text,p_branch text,p_base_sha text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_repository<>'omarimckie/MediMori' OR p_branch<>'main' OR coalesce(p_base_sha,'') !~ '^[a-f0-9]{40}$' THEN
    RETURN jsonb_build_object('ok',false,'code','target_lineage_invalid');
  END IF;
  result:=engineering_prepare_attempt(p_task,p_version,p_key,p_actor);
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'replayed'='true' THEN
    IF result->>'ok'='true' THEN
      UPDATE engineering_attempt_preparations SET target_repository=p_repository,target_branch=p_branch,target_base_sha=p_base_sha
        WHERE idempotency_key=p_key AND target_repository IS NULL AND target_branch IS NULL AND target_base_sha IS NULL;
      IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM engineering_attempt_preparations WHERE idempotency_key=p_key AND target_repository=p_repository AND target_branch=p_branch AND target_base_sha=p_base_sha) THEN
        RAISE EXCEPTION 'attempt_target_lineage_conflict';
      END IF;
    END IF;
    RETURN result;
  END IF;
  UPDATE engineering_attempt_preparations SET target_repository=p_repository,target_branch=p_branch,target_base_sha=p_base_sha
    WHERE idempotency_key=p_key AND task_id=p_task AND actor=p_actor AND target_repository IS NULL AND target_branch IS NULL AND target_base_sha IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_target_lineage_conflict'; END IF;
  RETURN result;
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
    WHERE r.id=p_run
      AND r.attempt_number IS NOT NULL
      AND r.plan_snapshot IS NOT DISTINCT FROM t.plan
      AND l.target_repository='omarimckie/MediMori'
      AND l.target_branch='main'
      AND EXISTS (SELECT 1 FROM engineering_approvals a
        WHERE a.task_id=r.task_id AND a.plan_version=r.plan_version AND a.gate='plan'
          AND a.decision='approved' AND a.actor NOT LIKE 'worker:%')
      AND (
        (l.attempt_number=1 AND l.previous_run_id IS NULL AND l.preparation_key IS NULL)
        OR EXISTS (
          SELECT 1 FROM engineering_attempt_preparations p
          JOIN engineering_runs previous ON previous.id=p.previous_run_id
            AND previous.task_id=p.task_id
            AND previous.attempt_number=p.previous_attempt_number
          WHERE p.idempotency_key=l.preparation_key AND p.task_id=l.task_id
            AND p.previous_run_id=l.previous_run_id
            AND p.previous_attempt_number+1=l.attempt_number
            AND p.target_repository=l.target_repository
            AND p.target_branch=l.target_branch
            AND p.target_base_sha=l.target_base_sha
        )
      )
  )
$$;

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

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='engineering_attempt_preparation_lineage_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER engineering_attempt_preparation_lineage_immutable BEFORE UPDATE OR DELETE ON engineering_attempt_preparations
      FOR EACH ROW EXECUTE FUNCTION engineering_lineage_immutable_guard();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='engineering_run_lineage_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER engineering_run_lineage_immutable BEFORE UPDATE OR DELETE ON engineering_run_lineage
      FOR EACH ROW EXECUTE FUNCTION engineering_lineage_immutable_guard();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='engineering_plan_lineage_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER engineering_plan_lineage_immutable BEFORE UPDATE OR DELETE ON engineering_plan_lineage
      FOR EACH ROW EXECUTE FUNCTION engineering_lineage_immutable_guard();
  END IF;
END $$;

REVOKE ALL ON engineering_run_lineage,engineering_plan_lineage FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_prepare_attempt_bound(uuid,integer,uuid,text,text,text,text) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_lineage_immutable_guard() FROM PUBLIC,medimori_engineering_worker;
