-- M2D additive schema. Review and apply manually to the disposable engineering
-- branch only. This file is prepared, not applied by application startup.
ALTER TABLE engineering_tasks DROP CONSTRAINT IF EXISTS engineering_tasks_status_check;
ALTER TABLE engineering_tasks ADD CONSTRAINT engineering_tasks_status_check CHECK (status IN ('intake','analyzing','planned','awaiting_approval','implementing','validating','repairing','reviewing','awaiting_merge','merging','completed','blocked','cancelled','escalated'));

CREATE TABLE IF NOT EXISTS engineering_merge_approvals (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  task_version integer NOT NULL CHECK (task_version >= 0),
  run_id uuid NOT NULL REFERENCES engineering_runs(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  resulting_revision text NOT NULL CHECK (resulting_revision ~ '^[a-f0-9]{40}$'),
  approved_files jsonb NOT NULL CHECK (jsonb_typeof(approved_files)='array' AND jsonb_array_length(approved_files) BETWEEN 1 AND 20),
  target_repository text NOT NULL CHECK (target_repository='omarimckie/MediMori'),
  target_branch text NOT NULL CHECK (target_branch='main'),
  target_base_sha text CHECK (target_base_sha IS NULL OR target_base_sha ~ '^[a-f0-9]{40}$'),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 120),
  idempotency_key uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('approved','rejected','revoked','consumed','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^[a-f0-9]{40}$')
);
CREATE INDEX IF NOT EXISTS engineering_merge_approval_task ON engineering_merge_approvals(task_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS engineering_merge_one_live_approval ON engineering_merge_approvals(task_id) WHERE status='approved';

CREATE TABLE IF NOT EXISTS engineering_merge_executions (
  id uuid PRIMARY KEY,
  approval_id uuid NOT NULL UNIQUE REFERENCES engineering_merge_approvals(id),
  task_id uuid NOT NULL REFERENCES engineering_tasks(id),
  run_id uuid NOT NULL REFERENCES engineering_runs(id),
  state text NOT NULL CHECK (state IN ('started','target_verified','diff_verified','commit_created','push_attempted','pushed','remote_verified','completed','blocked')),
  execution_base_sha text CHECK (execution_base_sha IS NULL OR execution_base_sha ~ '^[a-f0-9]{40}$'),
  commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^[a-f0-9]{40}$'),
  failure_code text CHECK (failure_code IS NULL OR failure_code IN ('target_changed','source_revision_mismatch','file_hash_mismatch','scope_mismatch','validation_failed','git_operation_failed','remote_verification_failed','approval_invalid','executor_configuration_invalid')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS engineering_merge_execution_task ON engineering_merge_executions(task_id,created_at DESC);

CREATE OR REPLACE FUNCTION engineering_merge_read_approval(p_approval uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a engineering_merge_approvals; t engineering_tasks; r engineering_runs; ev jsonb; execution engineering_merge_executions;
BEGIN
 IF session_user<>'medimori_engineering_merge_executor' THEN RAISE EXCEPTION 'merge_executor_required'; END IF;
 SELECT * INTO a FROM engineering_merge_approvals WHERE id=p_approval;
 IF NOT FOUND OR a.status NOT IN ('approved','consumed') THEN RAISE EXCEPTION 'merge_approval_unavailable'; END IF;
 SELECT * INTO t FROM engineering_tasks WHERE id=a.task_id;
 SELECT * INTO r FROM engineering_runs WHERE id=a.run_id AND task_id=a.task_id;
 SELECT details->'proposalEvidence' INTO ev FROM engineering_events WHERE task_id=a.task_id AND action='proposal_evidence' AND details->>'runId'=a.run_id::text AND details#>>'{proposalEvidence,workspaceRevision}'=a.resulting_revision ORDER BY created_at DESC LIMIT 1;
 SELECT * INTO execution FROM engineering_merge_executions WHERE approval_id=a.id;
 IF NOT FOUND OR t.plan IS NULL OR r.plan_version<>a.plan_version OR r.disposition<>'succeeded' OR r.finished_at IS NULL OR ev IS NULL OR execution.id IS NULL OR
   (a.status='approved' AND NOT ((t.status='awaiting_merge' AND t.version=a.task_version) OR (t.status='merging' AND t.version=a.task_version+1))) OR
   (a.status='consumed' AND (t.status<>'completed' OR t.version<>a.task_version+2 OR execution.state<>'completed' OR a.commit_sha IS NULL)) THEN RAISE EXCEPTION 'merge_binding_stale'; END IF;
 IF NOT engineering_run_lineage_valid(a.run_id) OR NOT EXISTS(SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=a.run_id AND l.target_repository=a.target_repository AND l.target_branch=a.target_branch AND l.target_base_sha=a.target_base_sha) THEN RAISE EXCEPTION 'merge_lineage_stale'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engineering_approvals ap WHERE ap.task_id=a.task_id AND ap.plan_version=a.plan_version AND ap.gate='plan' AND ap.decision='approved' AND ap.actor NOT LIKE 'worker:%') OR
   NOT EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=a.run_id AND c.call_key LIKE 'review:%' AND c.processing_state='review_validated') THEN RAISE EXCEPTION 'merge_human_or_review_evidence_stale'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(ev->'files') item
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.approved_files) bound WHERE bound->>'path'=item->>'path' AND bound->>'beforeSha256'=item->>'beforeSha256' AND bound->>'afterSha256'=item->>'afterSha256')) OR
   jsonb_array_length(ev->'files')<>jsonb_array_length(a.approved_files) THEN RAISE EXCEPTION 'merge_evidence_mismatch'; END IF;
 IF a.status='approved' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(t.plan->'validations') AS required(command) WHERE NOT EXISTS(
   SELECT 1 FROM engineering_validations v WHERE v.run_id=r.id AND v.command=required.command AND v.cycle=r.repairs AND v.outcome='passed' AND v.revision=a.resulting_revision)) THEN RAISE EXCEPTION 'merge_validation_stale'; END IF;
 RETURN jsonb_build_object('id',a.id,'taskId',a.task_id,'taskVersion',a.task_version,'runId',a.run_id,'attemptNumber',a.attempt_number,'planVersion',a.plan_version,
   'resultingRevision',a.resulting_revision,'files',a.approved_files,'target',jsonb_build_object('repository',a.target_repository,'branch',a.target_branch,'remote','origin'),
   'targetBaseSha',a.target_base_sha,'actor',a.actor,'idempotencyKey',a.idempotency_key,'status',a.status,'approvedAt',a.created_at,'commitSha',a.commit_sha);
END $$;

CREATE OR REPLACE FUNCTION engineering_create_merge_decision(
 p_task uuid,p_task_version integer,p_run uuid,p_attempt integer,p_plan_version integer,p_revision text,p_files jsonb,
 p_repository text,p_branch text,p_base_sha text,p_actor text,p_key uuid,p_decision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t engineering_tasks; r engineering_runs; old engineering_merge_approvals; ev jsonb; paths text[]; evidence_paths text[]; expected jsonb; new_id uuid:=gen_random_uuid();
BEGIN
 IF session_user='medimori_engineering_2c_worker' OR p_task_version IS NULL OR p_task_version<0 OR p_actor IS NULL OR p_actor !~ '^[^[:cntrl:]]{1,120}$' OR p_actor LIKE 'worker:%' OR p_key IS NULL OR p_decision NOT IN ('approved','rejected') OR p_repository<>'omarimckie/MediMori' OR p_branch<>'main' OR (p_decision='approved' AND (p_base_sha IS NULL OR p_base_sha !~ '^[a-f0-9]{40}$')) OR (p_decision='rejected' AND p_base_sha IS NOT NULL AND p_base_sha !~ '^[a-f0-9]{40}$') OR p_revision !~ '^[a-f0-9]{40}$' OR jsonb_typeof(p_files)<>'array' OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION 'merge_approval_invalid';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 SELECT * INTO old FROM engineering_merge_approvals WHERE idempotency_key=p_key;
 IF FOUND THEN
   IF old.task_id<>p_task OR old.task_version<>p_task_version OR old.run_id<>p_run OR old.attempt_number<>p_attempt OR old.plan_version<>p_plan_version OR old.resulting_revision<>p_revision OR old.approved_files<>p_files OR old.target_repository<>p_repository OR old.target_branch<>p_branch OR old.target_base_sha IS DISTINCT FROM p_base_sha OR old.actor<>p_actor OR NOT (old.status=p_decision OR (p_decision='approved' AND old.status IN ('consumed','blocked','revoked'))) THEN RAISE EXCEPTION 'merge_idempotency_conflict'; END IF;
   RETURN jsonb_build_object('ok',true,'replayed',true,'approvalId',old.id,'status',old.status);
 END IF;
 SELECT * INTO t FROM engineering_tasks WHERE id=p_task FOR UPDATE;
 IF NOT FOUND OR t.status<>'awaiting_merge' OR t.version<>p_task_version OR t.plan IS NULL OR jsonb_array_length(coalesce(t.plan->'operations','[]'::jsonb))<>0 THEN RAISE EXCEPTION 'merge_task_not_awaiting'; END IF;
 SELECT * INTO r FROM engineering_runs WHERE id=p_run AND task_id=p_task FOR UPDATE;
 IF NOT FOUND OR r.finished_at IS NULL OR r.disposition<>'succeeded' OR r.plan_version<>p_plan_version OR coalesce(r.attempt_number,p_attempt)<>p_attempt THEN RAISE EXCEPTION 'merge_run_mismatch'; END IF;
 IF NOT engineering_run_lineage_valid(p_run) OR NOT EXISTS(SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=p_run AND l.target_repository=p_repository AND l.target_branch=p_branch AND l.target_base_sha=p_base_sha) THEN RAISE EXCEPTION 'merge_lineage_mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engineering_approvals ap WHERE ap.task_id=p_task AND ap.plan_version=p_plan_version AND ap.gate='plan' AND ap.decision='approved' AND ap.actor NOT LIKE 'worker:%') THEN RAISE EXCEPTION 'merge_plan_approval_missing'; END IF;
 SELECT details->'proposalEvidence' INTO ev FROM engineering_events WHERE task_id=p_task AND action='proposal_evidence' AND details->>'runId'=p_run::text AND details#>>'{proposalEvidence,workspaceRevision}'=p_revision ORDER BY created_at DESC LIMIT 1;
 IF ev IS NULL OR ev->>'workspaceRevision'<>p_revision THEN RAISE EXCEPTION 'merge_evidence_missing'; END IF;
 SELECT array_agg(path ORDER BY path) INTO paths FROM jsonb_array_elements_text(t.plan->'files') AS planned(path);
 IF (SELECT array_agg(path ORDER BY path) FROM jsonb_array_elements_text(ev->'approvedPaths') AS approved(path)) IS DISTINCT FROM paths THEN RAISE EXCEPTION 'merge_approved_scope_mismatch'; END IF;
 SELECT array_agg(item->>'path' ORDER BY item->>'path') INTO evidence_paths FROM jsonb_array_elements(ev->'files') item;
 SELECT jsonb_agg(jsonb_build_object('path',item->>'path','beforeSha256',item->>'beforeSha256','afterSha256',item->>'afterSha256') ORDER BY item->>'path') INTO expected FROM jsonb_array_elements(ev->'files') item;
 IF expected IS DISTINCT FROM p_files OR evidence_paths IS NULL OR EXISTS(SELECT 1 FROM unnest(evidence_paths) x WHERE NOT (x=ANY(paths))) THEN RAISE EXCEPTION 'merge_files_mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engineering_worker_calls WHERE run_id=p_run AND call_key LIKE 'review:%' AND processing_state='review_validated') THEN RAISE EXCEPTION 'merge_self_review_missing'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(t.plan->'validations') AS required(command) WHERE NOT EXISTS(SELECT 1 FROM engineering_validations v WHERE v.run_id=p_run AND v.command=required.command AND v.cycle=r.repairs AND v.outcome='passed' AND v.revision=p_revision)) THEN RAISE EXCEPTION 'merge_validation_missing'; END IF;
 IF p_decision='approved' AND EXISTS(SELECT 1 FROM engineering_merge_approvals WHERE task_id=p_task AND status='approved') THEN RAISE EXCEPTION 'merge_approval_already_active'; END IF;
 INSERT INTO engineering_merge_approvals(id,task_id,task_version,run_id,attempt_number,plan_version,resulting_revision,approved_files,target_repository,target_branch,target_base_sha,actor,idempotency_key,status)
 VALUES(new_id,p_task,p_task_version,p_run,p_attempt,p_plan_version,p_revision,p_files,p_repository,p_branch,p_base_sha,p_actor,p_key,p_decision);
 INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),p_task,p_actor,CASE WHEN p_decision='approved' THEN 'merge_approval_created' ELSE 'merge_rejected' END,
   jsonb_build_object('approvalId',new_id,'runId',p_run,'attemptNumber',p_attempt,'planVersion',p_plan_version,'resultingRevision',p_revision,'files',p_files,'targetRepository',p_repository,'targetBranch',p_branch,'targetBaseSha',p_base_sha,'status',p_decision));
 RETURN jsonb_build_object('ok',true,'replayed',false,'approvalId',new_id,'status',p_decision);
END $$;

CREATE OR REPLACE FUNCTION engineering_merge_start(p_approval uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a engineering_merge_approvals; t engineering_tasks; e engineering_merge_executions; new_id uuid:=gen_random_uuid();
BEGIN
 IF session_user<>'medimori_engineering_merge_executor' THEN RAISE EXCEPTION 'merge_executor_required'; END IF;
 SELECT * INTO a FROM engineering_merge_approvals WHERE id=p_approval FOR UPDATE;
 IF NOT FOUND OR a.status<>'approved' THEN RAISE EXCEPTION 'merge_approval_unavailable'; END IF;
 SELECT * INTO e FROM engineering_merge_executions WHERE approval_id=p_approval FOR UPDATE;
 IF FOUND THEN
   IF e.state='blocked' THEN RAISE EXCEPTION 'merge_execution_blocked'; END IF;
   RETURN jsonb_build_object('ok',true,'replayed',true,'executionId',e.id,'state',e.state,'commitSha',e.commit_sha);
 END IF;
 SELECT * INTO t FROM engineering_tasks WHERE id=a.task_id FOR UPDATE;
 IF NOT FOUND OR t.status<>'awaiting_merge' OR NOT EXISTS(SELECT 1 FROM engineering_runs r WHERE r.id=a.run_id AND r.task_id=a.task_id AND r.plan_version=a.plan_version AND r.finished_at IS NOT NULL AND r.disposition='succeeded') OR NOT engineering_run_lineage_valid(a.run_id) OR NOT EXISTS(SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=a.run_id AND l.target_repository=a.target_repository AND l.target_branch=a.target_branch AND l.target_base_sha=a.target_base_sha) THEN RAISE EXCEPTION 'merge_task_run_mismatch'; END IF;
 UPDATE engineering_tasks SET status='merging',version=version+1,updated_at=now() WHERE id=t.id;
 INSERT INTO engineering_merge_executions(id,approval_id,task_id,run_id,state) VALUES(new_id,a.id,a.task_id,a.run_id,'started');
 INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),a.task_id,'merge-executor','merge_execution_started',jsonb_build_object('approvalId',a.id,'runId',a.run_id,'executionId',new_id));
 RETURN jsonb_build_object('ok',true,'replayed',false,'executionId',new_id,'state','started');
END $$;

CREATE OR REPLACE FUNCTION engineering_merge_progress(p_approval uuid,p_state text,p_base_sha text DEFAULT NULL,p_commit_sha text DEFAULT NULL,p_failure_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a engineering_merge_approvals; e engineering_merge_executions; allowed text[]:=ARRAY['target_verified','diff_verified','commit_created','push_attempted','pushed','remote_verified','blocked'];
BEGIN
 IF session_user<>'medimori_engineering_merge_executor' OR NOT (p_state=ANY(allowed)) THEN RAISE EXCEPTION 'merge_executor_operation_denied'; END IF;
 SELECT * INTO a FROM engineering_merge_approvals WHERE id=p_approval FOR UPDATE;
 SELECT * INTO e FROM engineering_merge_executions WHERE approval_id=p_approval FOR UPDATE;
 IF NOT FOUND OR a.status<>'approved' OR e.state IN ('completed','blocked') THEN RAISE EXCEPTION 'merge_execution_unavailable'; END IF;
 IF p_base_sha IS NOT NULL AND p_base_sha !~ '^[a-f0-9]{40}$' OR p_commit_sha IS NOT NULL AND p_commit_sha !~ '^[a-f0-9]{40}$' OR p_failure_code IS NOT NULL AND p_failure_code NOT IN ('target_changed','source_revision_mismatch','file_hash_mismatch','scope_mismatch','validation_failed','git_operation_failed','remote_verification_failed','approval_invalid','executor_configuration_invalid') THEN RAISE EXCEPTION 'merge_progress_invalid'; END IF;
 UPDATE engineering_merge_executions SET state=p_state,execution_base_sha=coalesce(p_base_sha,execution_base_sha),commit_sha=coalesce(p_commit_sha,commit_sha),failure_code=p_failure_code,updated_at=now() WHERE id=e.id;
 INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),a.task_id,'merge-executor','merge_'||p_state,jsonb_strip_nulls(jsonb_build_object('approvalId',a.id,'runId',a.run_id,'executionId',e.id,'baseSha',p_base_sha,'commitSha',p_commit_sha,'code',p_failure_code)));
 IF p_state='blocked' THEN
   UPDATE engineering_merge_approvals SET status='blocked' WHERE id=a.id;
   UPDATE engineering_tasks SET status='blocked',version=version+1,updated_at=now() WHERE id=a.task_id AND status='merging';
 END IF;
 RETURN jsonb_build_object('ok',true,'state',p_state,'executionId',e.id);
END $$;

CREATE OR REPLACE FUNCTION engineering_merge_complete(p_approval uuid,p_commit_sha text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a engineering_merge_approvals; e engineering_merge_executions; t engineering_tasks;
BEGIN
 IF session_user<>'medimori_engineering_merge_executor' OR p_commit_sha !~ '^[a-f0-9]{40}$' THEN RAISE EXCEPTION 'merge_executor_operation_denied'; END IF;
 SELECT * INTO a FROM engineering_merge_approvals WHERE id=p_approval FOR UPDATE;
 SELECT * INTO e FROM engineering_merge_executions WHERE approval_id=p_approval FOR UPDATE;
 SELECT * INTO t FROM engineering_tasks WHERE id=a.task_id FOR UPDATE;
 IF e.state='completed' AND a.status='consumed' AND a.commit_sha=p_commit_sha THEN RETURN jsonb_build_object('ok',true,'replayed',true,'commitSha',p_commit_sha); END IF;
 IF a.status<>'approved' OR e.state<>'remote_verified' OR e.commit_sha<>p_commit_sha OR t.status<>'merging' OR NOT engineering_run_lineage_valid(a.run_id) OR NOT EXISTS(SELECT 1 FROM engineering_run_lineage l WHERE l.run_id=a.run_id AND l.target_repository=a.target_repository AND l.target_branch=a.target_branch AND l.target_base_sha=a.target_base_sha) THEN RAISE EXCEPTION 'merge_completion_unverified'; END IF;
 UPDATE engineering_merge_executions SET state='completed',updated_at=now() WHERE id=e.id;
 UPDATE engineering_merge_approvals SET status='consumed',consumed_at=now(),commit_sha=p_commit_sha WHERE id=a.id;
 UPDATE engineering_tasks SET status='completed',version=version+1,updated_at=now() WHERE id=t.id;
 INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),a.task_id,'merge-executor','merge_completed',jsonb_build_object('approvalId',a.id,'runId',a.run_id,'commitSha',p_commit_sha,'targetBranch',a.target_branch));
 RETURN jsonb_build_object('ok',true,'replayed',false,'commitSha',p_commit_sha);
END $$;

REVOKE ALL ON engineering_merge_approvals,engineering_merge_executions FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_create_merge_decision(uuid,integer,uuid,integer,integer,text,jsonb,text,text,text,text,uuid,text) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_merge_read_approval(uuid) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_merge_start(uuid) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_merge_progress(uuid,text,text,text,text) FROM PUBLIC,medimori_engineering_worker;
REVOKE ALL ON FUNCTION engineering_merge_complete(uuid,text) FROM PUBLIC,medimori_engineering_worker;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_merge_executor') THEN
  GRANT EXECUTE ON FUNCTION engineering_merge_start(uuid) TO medimori_engineering_merge_executor;
  GRANT EXECUTE ON FUNCTION engineering_merge_read_approval(uuid) TO medimori_engineering_merge_executor;
  GRANT EXECUTE ON FUNCTION engineering_merge_progress(uuid,text,text,text,text) TO medimori_engineering_merge_executor;
  GRANT EXECUTE ON FUNCTION engineering_merge_complete(uuid,text) TO medimori_engineering_merge_executor;
 END IF;
END $$;
