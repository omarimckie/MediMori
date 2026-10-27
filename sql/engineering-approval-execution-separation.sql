-- Install after engineering-source-selection-policy.sql (migration eight).
-- Human approval is bound to one immutable prepared P+T+S subject. A distinct
-- authenticated control-plane action creates the executable run afterwards.
BEGIN;

ALTER TABLE engineering_tasks DROP CONSTRAINT IF EXISTS engineering_tasks_status_check;
ALTER TABLE engineering_tasks ADD CONSTRAINT engineering_tasks_status_check CHECK (status IN (
  'intake','analyzing','planned','awaiting_approval','awaiting_execution','implementing',
  'validating','repairing','reviewing','awaiting_merge','merging','completed','blocked','cancelled','escalated'
));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_prepared_attempts'::regclass AND conname='engineering_prepared_attempt_identity') THEN
    ALTER TABLE engineering_prepared_attempts ADD CONSTRAINT engineering_prepared_attempt_identity UNIQUE (attempt_id,task_id,plan_version);
  END IF;
END $$;

ALTER TABLE engineering_approvals ADD COLUMN IF NOT EXISTS prepared_attempt_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='engineering_approvals'::regclass AND conname='engineering_approvals_prepared_subject_fk') THEN
    ALTER TABLE engineering_approvals ADD CONSTRAINT engineering_approvals_prepared_subject_fk
      FOREIGN KEY (prepared_attempt_id,task_id,plan_version)
      REFERENCES engineering_prepared_attempts(attempt_id,task_id,plan_version);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS engineering_approvals_one_decision_per_prepared_subject
  ON engineering_approvals(prepared_attempt_id)
  WHERE prepared_attempt_id IS NOT NULL AND gate='plan';

-- Policy-v2 executions require an approval tied to this exact prepared subject.
-- Historical binding-version-0/1, policy-version-0 lineage remains readable
-- through its legacy unbound approval row.
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

-- Preserve the existing control-plane-only invocation boundary after replacing
-- the function body. CREATE OR REPLACE retains ACLs, and these revokes make the
-- intended worker/public denial explicit in this migration as well.
REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM PUBLIC,medimori_engineering_worker;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
    REVOKE ALL ON FUNCTION engineering_run_lineage_valid(uuid) FROM medimori_engineering_merge_executor;
  END IF;
END $$;

COMMIT;
