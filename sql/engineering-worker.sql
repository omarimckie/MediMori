-- Additive 2B migration. Disposable branch only. No LOGIN or password provisioned.
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS worker_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS lease_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS worker_revision text;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS preflight_revision text;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS reserved_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS reserved_micros bigint NOT NULL DEFAULT 0;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS sol_reason text;
-- Existing rows are intentionally not backfilled or rewritten. Legacy attempt
-- numbers are derived at read time; new attempts store an explicit number.
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS attempt_number integer CHECK (attempt_number IS NULL OR attempt_number > 0);
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;
ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS disposition text CHECK (disposition IS NULL OR disposition IN ('active','succeeded','blocked','cancelled','expired'));
CREATE UNIQUE INDEX IF NOT EXISTS engineering_run_attempt_number ON engineering_runs(task_id,attempt_number) WHERE attempt_number IS NOT NULL;
CREATE TABLE IF NOT EXISTS engineering_worker_calls (
 run_id uuid NOT NULL REFERENCES engineering_runs(id), call_key text NOT NULL,
 request_hash text NOT NULL, model text NOT NULL CHECK(model IN ('gpt-6-luna','gpt-6.1-sol')),
 reserved_tokens integer NOT NULL, reserved_micros bigint NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','sent','settled','uncertain')),
 actual_input integer, actual_output integer, actual_micros bigint, response_id text,
 rate_snapshot jsonb NOT NULL, processing_state text DEFAULT 'reserved' CHECK(processing_state IS NULL OR processing_state IN ('reserved','response_processed','proposal_validated','proposal_applied','review_validated','failed')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,call_key), UNIQUE(response_id)
);
ALTER TABLE engineering_worker_calls ADD COLUMN IF NOT EXISTS reported_model text;
ALTER TABLE engineering_worker_calls ADD COLUMN IF NOT EXISTS reported_tier text;
-- Keep legacy call rows unchanged; only new calls receive the reserved default.
ALTER TABLE engineering_worker_calls ADD COLUMN IF NOT EXISTS processing_state text;
ALTER TABLE engineering_worker_calls ALTER COLUMN processing_state SET DEFAULT 'reserved';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='engineering_worker_calls'::regclass AND conname='engineering_worker_call_processing_state') THEN
  ALTER TABLE engineering_worker_calls ADD CONSTRAINT engineering_worker_call_processing_state CHECK(processing_state IS NULL OR processing_state IN ('reserved','response_processed','proposal_validated','proposal_applied','review_validated','failed'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS engineering_worker_receipts (
 run_id uuid NOT NULL REFERENCES engineering_runs(id), receipt_key text NOT NULL,
 revision text NOT NULL, cycle integer NOT NULL, source text NOT NULL,
 command text NOT NULL, outcome text NOT NULL, PRIMARY KEY(run_id,receipt_key)
);
CREATE TABLE IF NOT EXISTS engineering_attempt_preparations (
 idempotency_key uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES engineering_tasks(id),
 previous_run_id uuid NOT NULL UNIQUE REFERENCES engineering_runs(id),
 actor text NOT NULL,
 from_version integer NOT NULL,
 to_version integer NOT NULL,
 previous_attempt_number integer NOT NULL,
 previous_disposition text NOT NULL CHECK (previous_disposition IN ('blocked','cancelled','expired')),
 previous_plan jsonb NOT NULL,
 previous_risk text,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Group A.1 worker lifecycle states are required by the worker contract; the
-- later merge migration adds only the merge-specific states.
ALTER TABLE engineering_tasks DROP CONSTRAINT IF EXISTS engineering_tasks_status_check;
ALTER TABLE engineering_tasks ADD CONSTRAINT engineering_tasks_status_check CHECK (status IN (
 'intake','analyzing','planned','awaiting_approval','implementing','validating',
 'repairing','reviewing','awaiting_merge','blocked','cancelled','escalated'
));

-- Human control-plane only. This operation closes a non-executable attempt and
-- returns the same durable request to planning; it never approves or creates a run.
CREATE OR REPLACE FUNCTION engineering_prepare_attempt(p_task uuid,p_version integer,p_key uuid,p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t engineering_tasks; r engineering_runs; p engineering_attempt_preparations; prior_no integer; closed_as text; prepared jsonb; prior_plan jsonb; prior_risk text;
BEGIN
 IF p_task IS NULL OR p_version IS NULL OR p_version<0 OR p_key IS NULL OR p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 120 OR session_user='medimori_engineering_2c_worker' THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_prepare_request');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 SELECT * INTO p FROM engineering_attempt_preparations WHERE idempotency_key=p_key;
 IF FOUND THEN
  IF p.task_id<>p_task OR p.actor<>p_actor OR p.from_version<>p_version THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
  SELECT * INTO t FROM engineering_tasks WHERE id=p_task;
  RETURN jsonb_build_object('ok',true,'replayed',true,'task',to_jsonb(t),'preparation',to_jsonb(p));
 END IF;
 SELECT * INTO t FROM engineering_tasks WHERE id=p_task FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','task_not_found'); END IF;
 IF t.version<>p_version THEN RETURN jsonb_build_object('ok',false,'code','stale_version'); END IF;
 IF t.status NOT IN ('implementing','validating','repairing','reviewing','blocked','cancelled') OR t.plan IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','task_not_retryable');
 END IF;
 prior_plan:=t.plan; prior_risk:=t.risk;
 SELECT * INTO r FROM engineering_runs WHERE task_id=p_task ORDER BY started_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR NOT r.worker_enabled THEN RETURN jsonb_build_object('ok',false,'code','execution_attempt_missing'); END IF;
 IF NOT EXISTS(SELECT 1 FROM engineering_approvals a WHERE a.task_id=p_task AND a.plan_version=r.plan_version AND a.gate='plan' AND a.decision='approved' AND a.actor NOT LIKE 'worker:%') THEN
  RETURN jsonb_build_object('ok',false,'code','prior_approval_missing');
 END IF;
 IF EXISTS(SELECT 1 FROM engineering_attempt_preparations WHERE previous_run_id=r.id) THEN
  RETURN jsonb_build_object('ok',false,'code','attempt_already_prepared');
 END IF;
 prior_no:=coalesce(r.attempt_number,(SELECT count(*)::integer FROM engineering_runs WHERE task_id=p_task));
 IF r.finished_at IS NULL THEN
  IF r.started_at>now()-interval '30 minutes' OR r.lease_until>now() THEN RETURN jsonb_build_object('ok',false,'code','attempt_still_executable'); END IF;
  IF r.disposition IS NOT NULL AND r.disposition<>'active' THEN RETURN jsonb_build_object('ok',false,'code','attempt_disposition_conflict'); END IF;
  IF r.reserved_tokens<>0 OR r.reserved_micros<>0 OR EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=r.id AND c.state IN ('reserved','sent','uncertain')) THEN
   RETURN jsonb_build_object('ok',false,'code','unresolved_provider_activity');
  END IF;
  closed_as:='expired';
 ELSIF r.disposition IN ('blocked','cancelled','expired') THEN
  closed_as:=r.disposition;
 ELSIF r.disposition IS NULL AND t.status IN ('blocked','cancelled') THEN
  closed_as:=t.status;
 ELSE
  RETURN jsonb_build_object('ok',false,'code','attempt_not_closed');
 END IF;
 IF closed_as='expired' AND t.status NOT IN ('implementing','validating','repairing','reviewing') THEN RETURN jsonb_build_object('ok',false,'code','task_attempt_state_mismatch'); END IF;
 IF closed_as IN ('blocked','cancelled') AND t.status NOT IN ('blocked','cancelled') THEN RETURN jsonb_build_object('ok',false,'code','task_attempt_state_mismatch'); END IF;
 IF r.finished_at IS NULL THEN
  UPDATE engineering_runs SET finished_at=now(),disposition='expired' WHERE id=r.id AND finished_at IS NULL;
 ELSE
  UPDATE engineering_runs SET disposition=closed_as WHERE id=r.id AND disposition IS NULL;
 END IF;
 UPDATE engineering_tasks SET status='analyzing',plan=NULL,risk=NULL,version=version+1,updated_at=now() WHERE id=p_task AND version=p_version RETURNING * INTO t;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','stale_version'); END IF;
 INSERT INTO engineering_attempt_preparations(idempotency_key,task_id,previous_run_id,actor,from_version,to_version,previous_attempt_number,previous_disposition,previous_plan,previous_risk)
 VALUES(p_key,p_task,r.id,p_actor,p_version,t.version,prior_no,closed_as,coalesce(r.plan_snapshot,prior_plan),prior_risk);
 INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),p_task,p_actor,'prepare_attempt',jsonb_build_object('fromVersion',p_version,'toVersion',t.version,'previousRunId',r.id,'previousAttemptNumber',prior_no,'previousDisposition',closed_as,'idempotencyKey',p_key));
 SELECT to_jsonb(x) INTO prepared FROM engineering_attempt_preparations x WHERE idempotency_key=p_key;
 RETURN jsonb_build_object('ok',true,'replayed',false,'task',to_jsonb(t),'preparation',prepared,'nextAttemptNumber',prior_no+1);
END $$;
REVOKE ALL ON FUNCTION engineering_prepare_attempt(uuid,integer,uuid,text) FROM PUBLIC;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='medimori_engineering_worker') THEN
  CREATE ROLE medimori_engineering_worker NOLOGIN;
 END IF;
END $$;
REVOKE ALL ON FUNCTION engineering_prepare_attempt(uuid,integer,uuid,text) FROM medimori_engineering_worker;

-- Single bounded ingress, callable only by a dedicated DB worker role. It cannot
-- intake, plan, approve, list unrelated tasks, issue SQL, merge or deploy.
CREATE OR REPLACE FUNCTION engineering_worker(run uuid, op text, owner text, epoch integer, data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r engineering_runs; t engineering_tasks; c engineering_worker_calls; event_details jsonb; audit_item jsonb; audit_evidence jsonb; validation_diag jsonb; emit_event boolean:=true;
 n integer; m bigint; result jsonb; rev text; cmd text; evidence_outcome text; preflight_new boolean;
BEGIN
 IF owner IS NULL OR length(owner) NOT BETWEEN 1 AND 120 OR epoch IS NULL OR epoch<0 OR data IS NULL OR jsonb_typeof(data)<>'object' THEN RAISE EXCEPTION 'invalid_worker_request'; END IF;
 SELECT * INTO r FROM engineering_runs WHERE id=run;
 IF NOT FOUND OR NOT r.worker_enabled THEN RAISE EXCEPTION 'worker_denied'; END IF;
 SELECT * INTO t FROM engineering_tasks WHERE id=r.task_id FOR UPDATE;
 SELECT * INTO r FROM engineering_runs WHERE id=run FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM engineering_approvals WHERE task_id=t.id AND plan_version=r.plan_version AND gate='plan' AND decision='approved') THEN RAISE EXCEPTION 'approval_required'; END IF;
 IF op='reconcile' THEN
  IF r.lease_owner IS DISTINCT FROM session_user||':'||owner OR r.lease_epoch<>epoch THEN RAISE EXCEPTION 'identity_denied'; END IF;
  -- Reconcile even after lease expiry/cancellation: do not abandon real charges.
  SELECT * INTO c FROM engineering_worker_calls WHERE run_id=run AND call_key=data->>'key' FOR UPDATE;
  IF NOT FOUND OR c.request_hash<>data->>'hash' THEN RAISE EXCEPTION 'unknown_call'; END IF;
  IF c.state='settled' THEN
   IF coalesce(data->>'reportedModel',c.model)<>c.model OR coalesce(data->>'tier','default')<>'default' OR c.response_id IS DISTINCT FROM data->>'responseId' OR c.actual_input<>(data->>'input')::integer OR c.actual_output<>(data->>'output')::integer OR c.actual_micros<>ceil((data->>'input')::integer*greatest((c.rate_snapshot->>'usageInput')::numeric,(c.rate_snapshot->>'usageCacheWrite')::numeric)+(data->>'output')::integer*(c.rate_snapshot->>'usageOutput')::numeric) THEN RAISE EXCEPTION 'replay_mismatch'; END IF;
   RETURN to_jsonb(c);
  END IF;
  IF c.state NOT IN ('sent','uncertain') THEN RAISE EXCEPTION 'not_sent'; END IF;
  n:=(data->>'input')::integer+(data->>'output')::integer; m:=ceil((data->>'input')::integer*greatest((c.rate_snapshot->>'usageInput')::numeric,(c.rate_snapshot->>'usageCacheWrite')::numeric)+(data->>'output')::integer*(c.rate_snapshot->>'usageOutput')::numeric);
  IF (data->>'input') IS NULL OR (data->>'output') IS NULL OR (data->>'input')::integer<0 OR (data->>'output')::integer<0 OR m<0 OR coalesce(data->>'responseId','')='' THEN RAISE EXCEPTION 'invalid_usage'; END IF;
  IF coalesce(data->>'reportedModel',c.model)<>c.model OR coalesce(data->>'tier','default')<>'default' THEN
   UPDATE engineering_worker_calls SET state='uncertain',actual_input=(data->>'input')::integer,actual_output=(data->>'output')::integer,reported_model=left(data->>'reportedModel',120),reported_tier=left(data->>'tier',40),response_id=data->>'responseId' WHERE run_id=run AND call_key=c.call_key;
   UPDATE engineering_tasks SET status='blocked',version=version+1 WHERE id=t.id AND status<>'cancelled';
   UPDATE engineering_runs SET finished_at=coalesce(finished_at,now()),lease_until=now() WHERE id=run;
   RETURN to_jsonb(r)||jsonb_build_object('plan',t.plan,'status','blocked');
  END IF;
  UPDATE engineering_worker_calls SET state='settled',reported_model=c.model,reported_tier='default',actual_input=(data->>'input')::integer,actual_output=(data->>'output')::integer,actual_micros=m,response_id=data->>'responseId' WHERE run_id=run AND call_key=c.call_key;
  UPDATE engineering_runs SET reserved_tokens=reserved_tokens-c.reserved_tokens,reserved_micros=reserved_micros-c.reserved_micros,
   tokens=least(60000,tokens+n),cost_usd=least(5,cost_usd+m/1000000.0) WHERE id=run;
  INSERT INTO engineering_costs(id,run_id,provider,model,operation,tokens,estimated_cost_usd) VALUES(gen_random_uuid(),run,'openai',c.model,'worker_actual',n,m/1000000.0);
  IF n>c.reserved_tokens OR m>c.reserved_micros OR r.cost_usd+m/1000000.0>.75 THEN
   UPDATE engineering_tasks SET status='blocked',version=version+1 WHERE id=t.id AND status<>'cancelled';
   UPDATE engineering_runs SET finished_at=coalesce(finished_at,now()),lease_until=now() WHERE id=run;
  END IF;
 ELSIF op='claim' THEN
  IF NOT engineering_run_lineage_valid(run) THEN RAISE EXCEPTION 'lineage_denied'; END IF;
  IF coalesce(data->>'preflightRevision','')!~'^[a-f0-9]{40}$' OR (r.preflight_revision IS NOT NULL AND r.preflight_revision IS DISTINCT FROM data->>'preflightRevision') THEN RAISE EXCEPTION 'preflight_revision_denied'; END IF;
  preflight_new:=r.preflight_revision IS NULL;
  IF EXISTS(SELECT 1 FROM engineering_runs newer WHERE newer.task_id=t.id AND (coalesce(newer.attempt_number,0)>coalesce(r.attempt_number,0) OR (coalesce(newer.attempt_number,0)=coalesce(r.attempt_number,0) AND (newer.started_at>r.started_at OR (newer.started_at=r.started_at AND newer.id>r.id))))) THEN RAISE EXCEPTION 'stale_attempt'; END IF;
  IF (r.disposition IS NOT NULL AND r.disposition<>'active') OR t.version<>r.plan_version+1 OR (r.plan_snapshot IS NOT NULL AND r.plan_snapshot IS DISTINCT FROM t.plan) THEN RAISE EXCEPTION 'stale_attempt'; END IF;
  IF length(owner) NOT BETWEEN 1 AND 120 OR t.status NOT IN ('implementing','validating','repairing','reviewing') OR r.finished_at IS NOT NULL OR r.started_at<=now()-interval '30 minutes' OR (r.lease_until>now() AND r.lease_owner IS DISTINCT FROM session_user||':'||owner) THEN RAISE EXCEPTION 'lease_denied'; END IF;
  IF EXISTS(SELECT 1 FROM engineering_worker_calls WHERE run_id=run AND state IN ('sent','uncertain')) THEN RAISE EXCEPTION 'unresolved_call'; END IF;
  UPDATE engineering_runs SET lease_owner=session_user||':'||owner,lease_epoch=lease_epoch+1,lease_until=now()+interval '90 seconds',preflight_revision=coalesce(preflight_revision,data->>'preflightRevision') WHERE id=run;
 ELSIF op='lineage' THEN
  IF data <> '{}'::jsonb OR NOT engineering_run_lineage_valid(run) OR NOT r.worker_enabled OR r.finished_at IS NOT NULL
    OR r.started_at<=now()-interval '30 minutes' OR r.lease_owner IS NOT NULL OR r.preflight_revision IS NOT NULL
    OR r.disposition IS DISTINCT FROM 'active' OR t.status NOT IN ('implementing','validating','repairing','reviewing')
    OR t.version<>r.plan_version+1 OR r.plan_snapshot IS DISTINCT FROM t.plan
    OR EXISTS(SELECT 1 FROM engineering_runs newer WHERE newer.task_id=t.id AND (coalesce(newer.attempt_number,0)>coalesce(r.attempt_number,0) OR (coalesce(newer.attempt_number,0)=coalesce(r.attempt_number,0) AND (newer.started_at>r.started_at OR (newer.started_at=r.started_at AND newer.id>r.id)))))
    OR EXISTS(SELECT 1 FROM engineering_worker_calls WHERE run_id=run AND state IN ('sent','uncertain')) THEN RAISE EXCEPTION 'lineage_denied'; END IF;
  SELECT to_jsonb(l) INTO result FROM engineering_run_lineage l WHERE l.run_id=run;
  RETURN result;
 ELSE
  IF r.lease_owner IS DISTINCT FROM session_user||':'||owner OR r.lease_epoch<>epoch OR r.lease_until<=now() OR r.finished_at IS NOT NULL OR r.started_at<=now()-interval '30 minutes' OR t.status NOT IN ('implementing','validating','repairing','reviewing') THEN RAISE EXCEPTION 'lease_denied'; END IF;
  IF op='heartbeat' THEN
   UPDATE engineering_runs SET lease_until=least(now()+interval '90 seconds',started_at+interval '30 minutes') WHERE id=run;
  ELSIF op='escalate' THEN
   IF length(coalesce(data->>'reason','')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'escalation_reason_required'; END IF;
   UPDATE engineering_runs SET sol_reason=data->>'reason' WHERE id=run;
  ELSIF op='proposal_evidence' THEN
   IF t.status NOT IN ('implementing','repairing') OR (SELECT count(*) FROM jsonb_object_keys(data))<>6 OR NOT (data ?& ARRAY['schemaVersion','approvedPaths','replacementCount','files','replacements','workspaceRevision']) THEN RAISE EXCEPTION 'proposal_evidence_denied'; END IF;
   IF jsonb_typeof(data->'schemaVersion') IS DISTINCT FROM 'number' OR data->>'schemaVersion'<>'1' OR jsonb_typeof(data->'approvedPaths') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'approvedPaths') NOT BETWEEN 1 AND 20 OR jsonb_typeof(data->'files') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'files') NOT BETWEEN 1 AND 8 OR jsonb_typeof(data->'replacements') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'replacements') NOT BETWEEN 1 AND 8 OR coalesce(data->>'replacementCount','') !~ '^[1-8]$' OR (data->>'replacementCount')::integer<>jsonb_array_length(data->'replacements') OR coalesce(data->>'workspaceRevision','') !~ '^[a-f0-9]{40}$' OR octet_length(data::text)>32768 THEN RAISE EXCEPTION 'proposal_evidence_denied'; END IF;
   IF jsonb_array_length(data->'approvedPaths')<>jsonb_array_length(t.plan->'files') OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'approvedPaths') p(value)
    WHERE jsonb_typeof(p.value)<>'string' OR length(p.value#>>'{}') NOT BETWEEN 1 AND 512 OR NOT (t.plan->'files' ? (p.value#>>'{}'))
   ) OR (SELECT count(DISTINCT value#>>'{}') FROM jsonb_array_elements(data->'approvedPaths'))<>jsonb_array_length(data->'approvedPaths') THEN RAISE EXCEPTION 'proposal_evidence_scope_denied'; END IF;
   FOR audit_item IN SELECT value FROM jsonb_array_elements(data->'files') LOOP
    IF jsonb_typeof(audit_item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(audit_item))<>7 OR NOT (audit_item ?& ARRAY['path','beforeSha256','afterSha256','beforeBytes','afterBytes','removedLines','addedLines']) OR coalesce(audit_item->>'path','')='' OR NOT (data->'approvedPaths' ? (audit_item->>'path')) OR coalesce(audit_item->>'beforeSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(audit_item->>'afterSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(audit_item->>'beforeBytes','') !~ '^(0|[1-9][0-9]{0,5})$' OR coalesce(audit_item->>'afterBytes','') !~ '^(0|[1-9][0-9]{0,5})$' OR (audit_item->>'beforeBytes')::integer>100000 OR (audit_item->>'afterBytes')::integer>100000 OR coalesce(audit_item->>'removedLines','') !~ '^(0|[1-9][0-9]{0,4})$' OR coalesce(audit_item->>'addedLines','') !~ '^(0|[1-9][0-9]{0,4})$' OR (audit_item->>'removedLines')::integer>64008 OR (audit_item->>'addedLines')::integer>64008 THEN RAISE EXCEPTION 'proposal_evidence_file_denied'; END IF;
   END LOOP;
   FOR audit_item IN SELECT value FROM jsonb_array_elements(data->'replacements') LOOP
    IF jsonb_typeof(audit_item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(audit_item))<>4 OR NOT (audit_item ?& ARRAY['path','expectedSha256','replacementSha256','changeSha256']) OR coalesce(audit_item->>'path','')='' OR NOT (data->'approvedPaths' ? (audit_item->>'path')) OR coalesce(audit_item->>'expectedSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(audit_item->>'replacementSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(audit_item->>'changeSha256','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'proposal_evidence_replacement_denied'; END IF;
   END LOOP;
   IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'files') f(value)
    WHERE (SELECT count(*) FROM jsonb_array_elements(data->'replacements') x(value) WHERE x.value->>'path'=f.value->>'path')=0
   ) OR (SELECT count(DISTINCT value->>'path') FROM jsonb_array_elements(data->'files'))<>jsonb_array_length(data->'files') OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'replacements') x(value)
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'files') f(value) WHERE f.value->>'path'=x.value->>'path')
   ) THEN RAISE EXCEPTION 'proposal_evidence_file_denied'; END IF;
   audit_evidence:=jsonb_build_object('schemaVersion',1,'approvedPaths',data->'approvedPaths','replacementCount',(data->>'replacementCount')::integer,'files',data->'files','replacements',data->'replacements','workspaceRevision',data->>'workspaceRevision');
   IF EXISTS(SELECT 1 FROM engineering_events WHERE task_id=t.id AND action='proposal_evidence' AND details->>'runId'=run::text AND details#>>'{proposalEvidence,workspaceRevision}'=data->>'workspaceRevision') THEN
    IF NOT EXISTS(SELECT 1 FROM engineering_events WHERE task_id=t.id AND action='proposal_evidence' AND details->>'runId'=run::text AND details#>>'{proposalEvidence,workspaceRevision}'=data->>'workspaceRevision' AND details->'proposalEvidence'=audit_evidence) THEN RAISE EXCEPTION 'proposal_evidence_replay_mismatch'; END IF;
    emit_event:=false;
   END IF;
  ELSIF op='reserve' THEN
   IF t.status NOT IN ('implementing','repairing','reviewing') THEN RAISE EXCEPTION 'call_stage_denied'; END IF;
   SELECT * INTO c FROM engineering_worker_calls WHERE run_id=run AND call_key=data->>'key';
   IF FOUND THEN
    IF c.request_hash<>data->>'hash' THEN RAISE EXCEPTION 'replay_mismatch'; END IF;
    RETURN to_jsonb(c);
   END IF;
   n:=(data->>'tokens')::integer; m:=(data->>'micros')::bigint;
   IF jsonb_typeof(data->'rates'->'usageInput') IS DISTINCT FROM 'number' OR jsonb_typeof(data->'rates'->'usageOutput') IS DISTINCT FROM 'number' OR jsonb_typeof(data->'rates'->'usageCacheWrite') IS DISTINCT FROM 'number' OR (data->'rates'->>'usageInput')::numeric < (CASE WHEN data->>'model'='gpt-6-luna' THEN .1 ELSE 2 END) OR (data->'rates'->>'usageOutput')::numeric < (CASE WHEN data->>'model'='gpt-6-luna' THEN .5 ELSE 10 END) OR (data->'rates'->>'usageCacheWrite')::numeric < (CASE WHEN data->>'model'='gpt-6-luna' THEN .125 ELSE 2.5 END) OR (data->'rates'->>'usageInput')::numeric>(data->'rates'->>'input')::numeric OR (data->'rates'->>'usageCacheWrite')::numeric>(data->'rates'->>'cacheWrite')::numeric OR (data->'rates'->>'usageOutput')::numeric>(data->'rates'->>'output')::numeric OR jsonb_typeof(data->'rates'->'input') IS DISTINCT FROM 'number' OR jsonb_typeof(data->'rates'->'output') IS DISTINCT FROM 'number' OR jsonb_typeof(data->'rates'->'cacheWrite') IS DISTINCT FROM 'number' OR coalesce(data->'rates'->>'endpoint','')<>'https://api.openai.com/v1/responses' OR coalesce(data->'rates'->>'tier','')<>'default' OR coalesce(data->'rates'->>'regime','')<>'worst-case-long-context' OR (data->'rates'->>'input')::numeric < (CASE WHEN data->>'model'='gpt-6-luna' THEN .55 ELSE 11 END) OR (data->'rates'->>'output')::numeric < (CASE WHEN data->>'model'='gpt-6-luna' THEN 1.65 ELSE 33 END) OR (data->'rates'->>'cacheWrite')::numeric < (CASE WHEN data->>'model'='gpt-6-luna' THEN .6875 ELSE 13.75 END) OR (data->>'inputBound')::integer<1 OR (data->>'inputBound')::integer>26000 OR (data->>'outputBound')::integer<1 OR (data->>'outputBound')::integer>8192 OR n IS DISTINCT FROM (data->>'inputBound')::integer+(data->>'outputBound')::integer OR m<ceil((data->>'inputBound')::integer*greatest((data->'rates'->>'input')::numeric,(data->'rates'->>'cacheWrite')::numeric)+(data->>'outputBound')::integer*(data->'rates'->>'output')::numeric) THEN RAISE EXCEPTION 'unsafe_quote'; END IF;
   IF coalesce(data->>'model','') NOT IN ('gpt-6-luna','gpt-6.1-sol') OR (data->>'model'='gpt-6.1-sol' AND r.sol_reason IS NULL) OR n<=0 OR m<=0 OR length(coalesce(data->>'key','')) NOT BETWEEN 1 AND 120 OR coalesce(data->>'hash','')!~'^[a-f0-9]{64}$' OR r.model_calls>=12 OR r.tokens+r.reserved_tokens+n>60000 OR r.cost_usd*1000000+r.reserved_micros+m>750000 THEN RAISE EXCEPTION 'reservation_denied'; END IF;
   IF EXISTS(SELECT 1 FROM engineering_worker_calls WHERE run_id=run AND state IN ('reserved','sent','uncertain')) THEN RAISE EXCEPTION 'pending_call'; END IF;
   INSERT INTO engineering_worker_calls(run_id,call_key,request_hash,model,reserved_tokens,reserved_micros,rate_snapshot) VALUES(run,data->>'key',data->>'hash',data->>'model',n,m,data->'rates');
   UPDATE engineering_runs SET model_calls=model_calls+1,reserved_tokens=reserved_tokens+n,reserved_micros=reserved_micros+m WHERE id=run;
   IF r.cost_usd*1000000+r.reserved_micros<250000 AND r.cost_usd*1000000+r.reserved_micros+m>=250000 THEN
    INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),t.id,'worker:'||session_user,'budget_warning',jsonb_build_object('runId',run,'cycle',r.repairs));
   END IF;
  ELSIF op='sent' OR op='uncertain' THEN
   UPDATE engineering_worker_calls SET state=op WHERE run_id=run AND call_key=data->>'key' AND request_hash=data->>'hash' AND state=CASE WHEN op='sent' THEN 'reserved' ELSE 'sent' END;
   IF NOT FOUND THEN RAISE EXCEPTION 'already_dispatched'; END IF;
  ELSIF op='revision' THEN
   IF coalesce(data->>'revision','')!~'^[a-f0-9]{40}$' OR t.status NOT IN ('implementing','repairing') OR NOT EXISTS(SELECT 1 FROM engineering_events WHERE task_id=t.id AND action='proposal_evidence' AND details->>'runId'=run::text AND details#>>'{proposalEvidence,workspaceRevision}'=data->>'revision') THEN RAISE EXCEPTION 'revision_denied'; END IF;
   UPDATE engineering_runs SET worker_revision=data->>'revision' WHERE id=run;
   UPDATE engineering_tasks SET status='validating',version=version+1 WHERE id=t.id;
  ELSIF op='validation_progress' THEN
    IF t.status<>'validating' OR coalesce(data->>'revision','')!~'^[a-f0-9]{40}$' OR data->>'revision' IS DISTINCT FROM r.worker_revision OR (SELECT count(*) FROM jsonb_object_keys(data))<>4 OR NOT (data ?& ARRAY['stage','revision','gate','cycle']) OR coalesce(data->>'stage','') NOT IN ('post_apply_verified','validation_environment_prepare_started','validation_environment_prepare_succeeded','validation_cycle_started','validation_gate_started') OR coalesce(data->>'cycle','')!~'^(0|[1-3])$' OR (data->>'cycle')::integer<>r.repairs OR ((data->>'stage')='validation_gate_started' AND coalesce(data->>'gate','') NOT IN ('test','lint','typecheck','build','security:check','test:engineering')) OR ((data->>'stage')<>'validation_gate_started' AND data->'gate' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'validation_progress_denied'; END IF;
    IF EXISTS(SELECT 1 FROM engineering_events WHERE task_id=t.id AND action='validation_progress' AND details->>'runId'=run::text AND details->>'progressStage'=data->>'stage' AND details->>'revision'=data->>'revision' AND details->>'cycle'=data->>'cycle' AND details->>'gate' IS NOT DISTINCT FROM data->>'gate') THEN emit_event:=false; END IF;
  ELSIF op='validation' THEN
   rev:=data->>'revision';cmd:=data->>'command';evidence_outcome:=data->>'outcome';
   IF t.status<>'validating' OR rev IS DISTINCT FROM r.worker_revision OR coalesce(cmd,'') NOT IN ('test','test:engineering','lint','typecheck','build','security:check') OR coalesce(evidence_outcome,'') NOT IN ('passed','failed') OR coalesce(data->>'source','') NOT IN ('worker','ci') OR length(coalesce(data->>'key','')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'evidence_denied'; END IF;
   validation_diag:=data->'diagnostic';
   IF jsonb_typeof(validation_diag)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(validation_diag))<>12 OR NOT (validation_diag ?& ARRAY['command','outcome','exitCode','containerExitCode','containerStatus','containerOomKilled','signal','timedOut','category','excerpt','failedTests','failedTestFiles']) OR octet_length(validation_diag::text)>3000 OR validation_diag->>'command' IS DISTINCT FROM cmd OR validation_diag->>'outcome' IS DISTINCT FROM evidence_outcome OR jsonb_typeof(validation_diag->'timedOut')<>'boolean' OR jsonb_typeof(validation_diag->'containerOomKilled') NOT IN ('boolean','null') OR NOT (validation_diag ? 'exitCode') OR NOT (validation_diag ? 'containerExitCode') OR NOT (validation_diag ? 'signal') OR coalesce(validation_diag->>'category','') NOT IN ('command_failed','process_signaled','process_spawn_failed','validation_timeout','docker_unavailable','validation_protocol_error','') OR coalesce(validation_diag->>'signal','') NOT IN ('SIGABRT','SIGBUS','SIGFPE','SIGILL','SIGKILL','SIGSEGV','SIGTERM','') OR (jsonb_typeof(validation_diag->'exitCode')<>'null' AND coalesce(validation_diag->>'exitCode','') !~ '^-?[0-9]{1,3}$') OR (jsonb_typeof(validation_diag->'containerExitCode')<>'null' AND coalesce(validation_diag->>'containerExitCode','') !~ '^-?[0-9]{1,3}$') OR (jsonb_typeof(validation_diag->'containerStatus')<>'null' AND coalesce(validation_diag->>'containerStatus','') NOT IN ('created','running','exited','dead','removing')) OR jsonb_typeof(validation_diag->'excerpt')<>'array' OR jsonb_array_length(validation_diag->'excerpt')>8 OR jsonb_typeof(validation_diag->'failedTests')<>'array' OR jsonb_array_length(validation_diag->'failedTests')>8 OR jsonb_typeof(validation_diag->'failedTestFiles')<>'array' OR jsonb_array_length(validation_diag->'failedTestFiles')>8 THEN RAISE EXCEPTION 'validation_diagnostic_denied'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(validation_diag->'excerpt') x(value) WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>240 OR (x.value#>>'{}') ~* '(postgres(ql)?://|sk-[A-Za-z0-9_-]{12,}|password[=:]|authorization[=:])') OR EXISTS(SELECT 1 FROM jsonb_array_elements(validation_diag->'failedTests') x(value) WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>200 OR (x.value#>>'{}') ~* '(postgres(ql)?://|sk-[A-Za-z0-9_-]{12,}|password[=:]|authorization[=:])') OR EXISTS(SELECT 1 FROM jsonb_array_elements(validation_diag->'failedTestFiles') x(value) WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>160 OR coalesce(x.value#>>'{}','') !~ '^src/lib/engineering/[A-Za-z0-9_.-]+\.test\.tsx?$') THEN RAISE EXCEPTION 'validation_diagnostic_unsafe'; END IF;
   IF EXISTS(SELECT 1 FROM engineering_worker_receipts WHERE run_id=run AND receipt_key=data->>'key') THEN
    IF NOT EXISTS(SELECT 1 FROM engineering_worker_receipts WHERE run_id=run AND receipt_key=data->>'key' AND revision=rev AND cycle=r.repairs AND command=cmd AND outcome=data->>'outcome') THEN RAISE EXCEPTION 'replay_mismatch'; END IF;
    RETURN to_jsonb(r)||jsonb_build_object('plan',t.plan,'status',t.status);
   END IF;
   INSERT INTO engineering_worker_receipts VALUES(run,data->>'key',rev,r.repairs,data->>'source',cmd,evidence_outcome);
   validation_diag:=validation_diag||jsonb_build_object('revision',rev,'cycle',r.repairs);
   INSERT INTO engineering_validations(id,run_id,command,outcome,revision,summary,cycle) VALUES(gen_random_uuid(),run,cmd,evidence_outcome,rev,validation_diag::text,r.repairs);
  ELSIF op='call_progress' THEN
   SELECT * INTO c FROM engineering_worker_calls WHERE run_id=run AND call_key=data->>'key' FOR UPDATE;
   IF NOT FOUND OR c.state<>'settled' OR length(coalesce(data->>'key','')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'call_progress_denied'; END IF;
   IF data->>'phase'='response_processed' AND c.processing_state='reserved' THEN
    UPDATE engineering_worker_calls SET processing_state='response_processed' WHERE run_id=run AND call_key=c.call_key;
   ELSIF data->>'phase'='proposal_validated' AND c.processing_state='response_processed' AND c.call_key LIKE 'implementation:%' THEN
    UPDATE engineering_worker_calls SET processing_state='proposal_validated' WHERE run_id=run AND call_key=c.call_key;
   ELSIF data->>'phase'='proposal_applied' AND c.processing_state='proposal_validated' AND c.call_key LIKE 'implementation:%' THEN
    UPDATE engineering_worker_calls SET processing_state='proposal_applied' WHERE run_id=run AND call_key=c.call_key;
   ELSIF data->>'phase'='review_validated' AND c.processing_state='response_processed' AND c.call_key LIKE 'review:%' THEN
    UPDATE engineering_worker_calls SET processing_state='review_validated' WHERE run_id=run AND call_key=c.call_key;
   ELSIF data->>'phase'='failed' AND c.processing_state NOT IN ('proposal_applied','review_validated','failed') AND coalesce(data->>'failureCode','') IN ('provider_incomplete','proposal_invalid_json','proposal_invalid_shape','proposal_out_of_scope','proposal_invalid_content','proposal_apply_failed','proposal_evidence_rejected','proposal_evidence_persist_failed','call_progress_persist_failed','replacement_target_missing','replacement_target_ambiguous','replacement_overlap','replacement_scope_rejected','replacement_revision_mismatch','replacement_content_invalid','replacement_apply_failed','worker_failure') THEN
    UPDATE engineering_worker_calls SET processing_state='failed' WHERE run_id=run AND call_key=c.call_key;
   ELSE RAISE EXCEPTION 'call_progress_transition_denied'; END IF;
  ELSIF op='repair' THEN
   IF t.status<>'validating' OR r.repairs>=3 OR NOT EXISTS(SELECT 1 FROM engineering_validations WHERE run_id=run AND cycle=r.repairs AND outcome='failed') THEN RAISE EXCEPTION 'repair_denied'; END IF;
   UPDATE engineering_runs SET repairs=repairs+1,worker_revision=NULL WHERE id=run;
   UPDATE engineering_tasks SET status='repairing',version=version+1 WHERE id=t.id;
  ELSIF op='review' THEN
   IF t.status<>'validating' OR r.worker_revision IS NULL OR EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(t.plan->'validations') needed(command_name) WHERE NOT EXISTS(SELECT 1 FROM engineering_validations v JOIN engineering_worker_receipts e ON e.run_id=v.run_id AND e.cycle=v.cycle AND e.command=v.command AND e.revision=v.revision WHERE v.run_id=run AND v.cycle=r.repairs AND v.command=needed.command_name AND v.outcome='passed' AND v.revision=r.worker_revision)
   ) THEN RAISE EXCEPTION 'validation_required'; END IF;
   UPDATE engineering_tasks SET status='reviewing',version=version+1 WHERE id=t.id;
  ELSIF op='finish' THEN
   IF t.status<>'reviewing' OR data->>'revision' IS DISTINCT FROM r.worker_revision OR data->>'outcome' IS DISTINCT FROM 'passed' OR EXISTS(SELECT 1 FROM engineering_worker_calls WHERE run_id=run AND state<>'settled') THEN RAISE EXCEPTION 'review_required'; END IF;
   UPDATE engineering_tasks SET status='awaiting_merge',version=version+1 WHERE id=t.id;
   UPDATE engineering_runs SET finished_at=now(),lease_until=now(),disposition='succeeded' WHERE id=run;
  ELSIF op='block' THEN
   UPDATE engineering_tasks SET status='blocked',version=version+1 WHERE id=t.id;
   UPDATE engineering_runs SET finished_at=now(),lease_until=now(),disposition='blocked' WHERE id=run;
  ELSE RAISE EXCEPTION 'operation_denied'; END IF;
 END IF;
 event_details:=jsonb_build_object('runId',run,'cycle',r.repairs,'leaseEpoch',r.lease_epoch);
  IF op='call_progress' THEN event_details:=event_details||jsonb_build_object('callKey',data->>'key','phase',data->>'phase','failureCode',CASE WHEN data->>'phase'='failed' THEN data->>'failureCode' ELSE NULL END); END IF;
  IF op='validation_progress' THEN event_details:=event_details||jsonb_build_object('progressStage',data->>'stage','revision',data->>'revision','gate',data->'gate'); END IF;
 IF op='block' AND jsonb_typeof(data->'diagnostic')='object' THEN
  event_details:=event_details||jsonb_build_object('diagnostic',jsonb_strip_nulls(jsonb_build_object(
   'stage',CASE WHEN data#>>'{diagnostic,stage}' IN ('implementation','review','worker') THEN data#>>'{diagnostic,stage}' ELSE 'worker' END,
    'operation',CASE WHEN data#>>'{diagnostic,operation}' IN ('provider_call','apply_proposal','prepare_validation_environment','run_validation','workspace_cleanup','worker_lifecycle') THEN data#>>'{diagnostic,operation}' ELSE NULL END,
    'category',CASE WHEN data#>>'{diagnostic,category}' IN ('provider_failure','proposal_failure','validation_failure','cleanup_failure','worker_failure') THEN data#>>'{diagnostic,category}' ELSE NULL END,
    'cleanupOutcome',CASE WHEN data#>>'{diagnostic,cleanupOutcome}' IN ('succeeded','failed','not_attempted') THEN data#>>'{diagnostic,cleanupOutcome}' ELSE NULL END,
    'code',CASE WHEN data#>>'{diagnostic,code}' IN ('provider_incomplete','proposal_invalid_json','proposal_invalid_shape','proposal_out_of_scope','proposal_invalid_content','proposal_apply_failed','proposal_evidence_rejected','proposal_evidence_persist_failed','call_progress_persist_failed','replacement_target_missing','replacement_target_ambiguous','replacement_overlap','replacement_scope_rejected','replacement_revision_mismatch','replacement_content_invalid','replacement_apply_failed','validation_executor_unavailable','validation_protocol_error','validation_source_prepare_failed','validation_overlay_prepare_failed','validation_dependency_unavailable','validation_image_unavailable','validation_start_persistence_failed','validation_evidence_persistence_failed','post_apply_revision_mismatch','post_apply_scope_verification_failed','lease_or_fence_lost','runtime_deadline_exceeded','sandbox_cleanup_failed','worker_failure') THEN data#>>'{diagnostic,code}' ELSE 'worker_failure' END,
    'validationStage',CASE WHEN data#>>'{diagnostic,validationStage}' IN ('docker_preflight','image_check','dependency_check','source_volume','next_env_overlay','post_apply_verification','validation_environment_prepare','validation_cycle','validation_gate','validation_progress','validation_evidence') THEN data#>>'{diagnostic,validationStage}' ELSE NULL END,
    'validationRevision',CASE WHEN coalesce(data#>>'{diagnostic,validationRevision}','')~'^[a-f0-9]{40}$' THEN data#>>'{diagnostic,validationRevision}' ELSE NULL END,
    'validationGate',CASE WHEN data#>>'{diagnostic,validationGate}' IN ('test','lint','typecheck','build','security:check','test:engineering') THEN data#>>'{diagnostic,validationGate}' ELSE NULL END,
   'shapeCategory',CASE WHEN data#>>'{diagnostic,shapeCategory}' IN ('top_level_not_object','missing_replacements','replacements_not_array','replacement_not_object','missing_path','missing_expected_text','missing_replacement_text','unexpected_field','wrong_field_type','empty_replacements','excessive_replacements','other_schema_mismatch') THEN data#>>'{diagnostic,shapeCategory}' ELSE NULL END,
   'replacementCount',CASE WHEN coalesce(data#>>'{diagnostic,replacementCount}','') ~ '^[0-9]{1,3}$' THEN least((data#>>'{diagnostic,replacementCount}')::integer,100) ELSE NULL END,
   'progressPhase',CASE WHEN data#>>'{diagnostic,progressPhase}' IN ('response_processed','proposal_validated','proposal_applied','review_validated') THEN data#>>'{diagnostic,progressPhase}' ELSE NULL END,
   'responseId',left(coalesce(data#>>'{diagnostic,responseId}',''),120),
   'responseStatus',CASE WHEN data#>>'{diagnostic,responseStatus}' IN ('completed','incomplete','failed','unknown') THEN data#>>'{diagnostic,responseStatus}' ELSE 'unknown' END,
   'incompleteReason',CASE WHEN data#>>'{diagnostic,incompleteReason}' IN ('max_output_tokens','content_filter','other') THEN data#>>'{diagnostic,incompleteReason}' ELSE NULL END,
   'outputTokens',CASE WHEN coalesce(data#>>'{diagnostic,outputTokens}','') ~ '^[0-9]{1,9}$' THEN least((data#>>'{diagnostic,outputTokens}')::integer,100000000) ELSE NULL END,
   'outputLimit',CASE WHEN coalesce(data#>>'{diagnostic,outputLimit}','') ~ '^[0-9]{1,9}$' THEN least((data#>>'{diagnostic,outputLimit}')::integer,100000000) ELSE NULL END,
   'cleanupFailures',CASE WHEN jsonb_typeof(data#>'{diagnostic,cleanupFailures}')='array' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('resourceType',CASE WHEN item->>'resourceType' IN ('populate-container','validation-container','source-volume','cache-volume','uploads-volume','private-volume') THEN item->>'resourceType' ELSE 'unknown' END,'category',CASE WHEN item->>'category' IN ('docker_unavailable','resource_in_use','already_absent','docker_error','too_many_owned_resources') THEN item->>'category' ELSE 'docker_error' END)),'[]'::jsonb) FROM (SELECT value AS item FROM jsonb_array_elements(data#>'{diagnostic,cleanupFailures}') LIMIT 16) bounded) ELSE NULL END)));
 END IF;
 IF op='proposal_evidence' THEN event_details:=event_details||jsonb_build_object('proposalEvidence',audit_evidence); END IF;
 IF emit_event THEN INSERT INTO engineering_events(id,task_id,actor,action,details) VALUES(gen_random_uuid(),t.id,'worker:'||session_user,op,event_details); END IF;
 SELECT to_jsonb(x) INTO result FROM engineering_runs x WHERE id=run;
 RETURN result || jsonb_build_object('plan',t.plan,'status',(SELECT status FROM engineering_tasks WHERE id=t.id),'softWarning',(SELECT cost_usd*1000000+reserved_micros>=250000 FROM engineering_runs WHERE id=run),'preflight_bound_now',preflight_new);
END $$;
REVOKE ALL ON FUNCTION engineering_worker(uuid,text,text,integer,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO medimori_engineering_worker;
GRANT EXECUTE ON FUNCTION engineering_worker(uuid,text,text,integer,jsonb) TO medimori_engineering_worker;
REVOKE ALL ON engineering_tasks,engineering_runs,engineering_approvals,engineering_validations,engineering_costs,engineering_events,engineering_worker_calls,engineering_worker_receipts,engineering_attempt_preparations FROM medimori_engineering_worker;
