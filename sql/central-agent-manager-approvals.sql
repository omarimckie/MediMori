-- UNAPPLIED PROPOSAL. Do not execute this file in the current task.
-- Do not apply it to Production (ep-muddy-math-auxmesyz, branch br-quiet-fire-ausvjkg8,
-- or ep-gentle-dawn-au6vxirn, branch br-little-art-au7ke21s, project solitary-leaf-77946642).
-- A later authorization would apply it only to project aged-brook-70202332,
-- branch br-nameless-mode-b7hkls9l, database neondb, and only with a client that
-- honors the single Part B transaction below.
-- This script does not set a password and does not connect an application.

-- Administrator threat model, separate from the constraints below.
-- A role that can replace these functions, disable these triggers, alter
-- row-level security, or change role attributes can retarget an approval.
-- neondb_owner has CREATEROLE, CREATEDB, and BYPASSRLS, so it remains outside
-- this boundary. Do not use it as an approval or execution connection.
-- owner_username is an attestation recorded by the approval authority role.
-- It is not proof that an admin cookie was verified. The application may
-- connect as the authority role only after that cookie check. The executor
-- role cannot mint or revoke approvals.

-- digest-fixture-task: {"allowedCapabilityScope":["merge_main","production_deploy"],"budget":{"concurrentSessions":1,"costUsd":5,"durationMs":1800000,"fileChanges":20,"modelCalls":12,"repairs":3,"tokens":60000},"isolation":"isolated_workspace","planVersion":3,"prohibitions":[],"requestedOperations":["merge_main","production_deploy"],"sourceRevision":null,"specialistId":"engineering","targetRevision":null,"taskId":"task-1","validationRequired":true}
-- digest-fixture-task-sha256: 5bc26039d6ef7c74c6515bf2e3146f7bdec3cb69a7fcf9ea9e71076c7931c57f
-- digest-fixture-approval: {"allowedCapabilityScope":["merge_main","production_deploy"],"budget":{"concurrentSessions":1,"costUsd":5,"durationMs":1800000,"fileChanges":20,"modelCalls":12,"repairs":3,"tokens":60000},"environment":"local","isolation":"isolated_workspace","operation":"merge_main","planVersion":3,"prohibitions":[],"requestedOperations":["merge_main","production_deploy"],"sourceRevision":null,"specialistId":"engineering","targetRevision":null,"taskId":"task-1","validationRequired":true}
-- digest-fixture-approval-sha256: 2d14ea1020368cfcb561634e3ba1de35665208bef9359054c3edf3c800d8d466

-- Part A. Empty roles. These statements autocommit. They grant nothing.
CREATE ROLE central_agent_manager_approval_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE central_agent_manager_approval_authority
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE central_agent_manager_executor
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

-- Part B. One transaction. A failure rolls the functions and grants back.
BEGIN;
GRANT central_agent_manager_approval_owner TO CURRENT_USER;

CREATE SCHEMA central_agent_manager;
REVOKE ALL ON SCHEMA central_agent_manager FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA central_agent_manager REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $extension$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION pgcrypto WITH SCHEMA central_agent_manager;
  END IF;
END
$extension$;

CREATE TABLE central_agent_manager.task_plans (
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  specialist_id text NOT NULL CHECK (specialist_id IN ('marketing', 'engineering', 'research', 'operations')),
  requested_operations text[] NOT NULL,
  allowed_capability_scope text[] NOT NULL,
  budget_model_calls integer NOT NULL CHECK (budget_model_calls >= 0),
  budget_tokens integer NOT NULL CHECK (budget_tokens >= 0),
  budget_cost_usd integer NOT NULL CHECK (budget_cost_usd >= 0),
  budget_duration_ms integer NOT NULL CHECK (budget_duration_ms >= 0),
  budget_repairs integer NOT NULL CHECK (budget_repairs >= 0),
  budget_file_changes integer NOT NULL CHECK (budget_file_changes >= 0),
  budget_concurrent_sessions integer NOT NULL CHECK (budget_concurrent_sessions >= 0),
  validation_required boolean NOT NULL,
  isolation text NOT NULL CHECK (isolation IN ('shared_process', 'isolated_workspace', 'read_only_credential')),
  prohibitions text[] NOT NULL,
  source_revision text,
  target_revision text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, plan_version, plan_digest),
  CHECK (source_revision IS NULL AND target_revision IS NULL)
);

CREATE TABLE central_agent_manager.tasks (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  specialist_id text NOT NULL CHECK (specialist_id IN ('marketing', 'engineering', 'research', 'operations')),
  state text NOT NULL CHECK (state IN (
    'created', 'awaiting_approval', 'approved', 'running', 'completed', 'failed', 'cancelled', 'blocked'
  )),
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (id, plan_version, plan_digest)
    REFERENCES central_agent_manager.task_plans (task_id, plan_version, plan_digest)
);

CREATE TABLE central_agent_manager.approvals (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  operation text NOT NULL CHECK (operation IN (
    'external_publish', 'send_notification', 'modify_live_schedule',
    'merge_main', 'production_deploy', 'production_secrets', 'destructive_database',
    'auth_security', 'payments', 'production_infrastructure'
  )),
  plan_version integer NOT NULL CHECK (plan_version >= 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  task_plan_digest text NOT NULL CHECK (task_plan_digest ~ '^[0-9a-f]{64}$'),
  specialist_id text NOT NULL CHECK (specialist_id IN ('marketing', 'engineering', 'research', 'operations')),
  environment text NOT NULL CHECK (environment ~ '^[A-Za-z0-9_.-]{1,40}$'),
  owner_username text NOT NULL CHECK (owner_username ~ '^[A-Za-z0-9_.-]{1,80}$'),
  db_session_user text NOT NULL CHECK (db_session_user = 'central_agent_manager_approval_authority'),
  decision text NOT NULL CHECK (decision = 'approved'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9_.-]{1,80}$'),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
  FOREIGN KEY (task_id, plan_version, task_plan_digest)
    REFERENCES central_agent_manager.task_plans (task_id, plan_version, plan_digest)
);

CREATE UNIQUE INDEX central_agent_manager_one_live_approval
  ON central_agent_manager.approvals (task_id, operation, plan_version)
  WHERE revoked_at IS NULL;

CREATE TABLE central_agent_manager.approval_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_id text NOT NULL REFERENCES central_agent_manager.approvals (id),
  event text NOT NULL CHECK (event IN ('issued', 'revoked')),
  at timestamptz NOT NULL,
  actor text NOT NULL CHECK (actor = 'central_agent_manager_approval_authority')
);

CREATE FUNCTION central_agent_manager.json_number(p_value numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_value IS NULL OR p_value < -9007199254740991 OR p_value > 9007199254740991 OR p_value <> trunc(p_value) THEN
    RAISE EXCEPTION 'plan_digest_rejected';
  END IF;
  RETURN trunc(p_value)::bigint::text;
END;
$$;

CREATE FUNCTION central_agent_manager.json_string_array(p_values text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_item text;
  v_out text := '';
  v_first boolean := true;
BEGIN
  IF p_values IS NULL THEN
    RAISE EXCEPTION 'plan_digest_rejected';
  END IF;
  FOR v_item IN
    SELECT value FROM unnest(p_values) AS value ORDER BY value COLLATE "C"
  LOOP
    IF v_item !~ '^[A-Za-z0-9_.-]{1,80}$' THEN
      RAISE EXCEPTION 'plan_digest_rejected';
    END IF;
    IF NOT v_first THEN
      v_out := v_out || ',';
    END IF;
    v_first := false;
    v_out := v_out || '"' || v_item || '"';
  END LOOP;
  RETURN '[' || v_out || ']';
END;
$$;

CREATE FUNCTION central_agent_manager.sha256_hex(p_payload text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_hash text;
BEGIN
  IF to_regprocedure('central_agent_manager.digest(bytea, text)') IS NOT NULL THEN
    EXECUTE 'SELECT encode(central_agent_manager.digest(convert_to($1, ''UTF8''), ''sha256''), ''hex'')'
      INTO v_hash USING p_payload;
  ELSIF to_regprocedure('extensions.digest(bytea, text)') IS NOT NULL THEN
    EXECUTE 'SELECT encode(extensions.digest(convert_to($1, ''UTF8''), ''sha256''), ''hex'')'
      INTO v_hash USING p_payload;
  ELSIF to_regprocedure('public.digest(bytea, text)') IS NOT NULL THEN
    EXECUTE 'SELECT encode(public.digest(convert_to($1, ''UTF8''), ''sha256''), ''hex'')'
      INTO v_hash USING p_payload;
  ELSE
    RAISE EXCEPTION 'plan_digest_unavailable';
  END IF;
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'plan_digest_unavailable';
  END IF;
  RETURN v_hash;
END;
$$;

CREATE FUNCTION central_agent_manager.canonical_task_json(
  p_task_id text,
  p_plan_version integer,
  p_specialist_id text,
  p_requested_operations text[],
  p_allowed_capability_scope text[],
  p_model_calls integer,
  p_tokens integer,
  p_cost_usd integer,
  p_duration_ms integer,
  p_repairs integer,
  p_file_changes integer,
  p_concurrent_sessions integer,
  p_validation_required boolean,
  p_isolation text,
  p_prohibitions text[]
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, central_agent_manager
AS $$
BEGIN
  IF p_task_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_specialist_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_isolation NOT IN ('shared_process', 'isolated_workspace', 'read_only_credential')
     OR p_validation_required IS NULL
  THEN
    RAISE EXCEPTION 'plan_digest_rejected';
  END IF;
  RETURN '{"allowedCapabilityScope":' || central_agent_manager.json_string_array(p_allowed_capability_scope)
    || ',"budget":{"concurrentSessions":' || central_agent_manager.json_number(p_concurrent_sessions)
    || ',"costUsd":' || central_agent_manager.json_number(p_cost_usd)
    || ',"durationMs":' || central_agent_manager.json_number(p_duration_ms)
    || ',"fileChanges":' || central_agent_manager.json_number(p_file_changes)
    || ',"modelCalls":' || central_agent_manager.json_number(p_model_calls)
    || ',"repairs":' || central_agent_manager.json_number(p_repairs)
    || ',"tokens":' || central_agent_manager.json_number(p_tokens)
    || '},"isolation":"' || p_isolation
    || '","planVersion":' || central_agent_manager.json_number(p_plan_version)
    || ',"prohibitions":' || central_agent_manager.json_string_array(p_prohibitions)
    || ',"requestedOperations":' || central_agent_manager.json_string_array(p_requested_operations)
    || ',"sourceRevision":null,"specialistId":"' || p_specialist_id
    || '","targetRevision":null,"taskId":"' || p_task_id
    || '","validationRequired":' || CASE WHEN p_validation_required THEN 'true' ELSE 'false' END
    || '}';
END;
$$;

CREATE FUNCTION central_agent_manager.canonical_approval_json(
  p_task_id text,
  p_plan_version integer,
  p_specialist_id text,
  p_requested_operations text[],
  p_allowed_capability_scope text[],
  p_model_calls integer,
  p_tokens integer,
  p_cost_usd integer,
  p_duration_ms integer,
  p_repairs integer,
  p_file_changes integer,
  p_concurrent_sessions integer,
  p_validation_required boolean,
  p_isolation text,
  p_prohibitions text[],
  p_operation text,
  p_environment text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, central_agent_manager
AS $$
BEGIN
  IF p_task_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_specialist_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_isolation NOT IN ('shared_process', 'isolated_workspace', 'read_only_credential')
     OR p_operation !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_environment !~ '^[A-Za-z0-9_.-]{1,40}$'
     OR p_validation_required IS NULL
  THEN
    RAISE EXCEPTION 'plan_digest_rejected';
  END IF;
  RETURN '{"allowedCapabilityScope":' || central_agent_manager.json_string_array(p_allowed_capability_scope)
    || ',"budget":{"concurrentSessions":' || central_agent_manager.json_number(p_concurrent_sessions)
    || ',"costUsd":' || central_agent_manager.json_number(p_cost_usd)
    || ',"durationMs":' || central_agent_manager.json_number(p_duration_ms)
    || ',"fileChanges":' || central_agent_manager.json_number(p_file_changes)
    || ',"modelCalls":' || central_agent_manager.json_number(p_model_calls)
    || ',"repairs":' || central_agent_manager.json_number(p_repairs)
    || ',"tokens":' || central_agent_manager.json_number(p_tokens)
    || '},"environment":"' || p_environment
    || '","isolation":"' || p_isolation
    || '","operation":"' || p_operation
    || '","planVersion":' || central_agent_manager.json_number(p_plan_version)
    || ',"prohibitions":' || central_agent_manager.json_string_array(p_prohibitions)
    || ',"requestedOperations":' || central_agent_manager.json_string_array(p_requested_operations)
    || ',"sourceRevision":null,"specialistId":"' || p_specialist_id
    || '","targetRevision":null,"taskId":"' || p_task_id
    || '","validationRequired":' || CASE WHEN p_validation_required THEN 'true' ELSE 'false' END
    || '}';
END;
$$;

CREATE FUNCTION central_agent_manager.assert_session_identity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_database() IS DISTINCT FROM 'neondb'
     OR current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-nameless-mode-b7hkls9l'
     OR session_user::text NOT IN (
       'central_agent_manager_executor',
       'central_agent_manager_approval_authority'
     )
  THEN
    RAISE EXCEPTION 'approval_database_identity_rejected';
  END IF;
END;
$$;

CREATE FUNCTION central_agent_manager.assert_approval_authority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, central_agent_manager
AS $$
BEGIN
  PERFORM central_agent_manager.assert_session_identity();
  IF session_user::text IS DISTINCT FROM 'central_agent_manager_approval_authority' THEN
    RAISE EXCEPTION 'approval_authority_required';
  END IF;
END;
$$;

CREATE FUNCTION central_agent_manager.assert_executor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, central_agent_manager
AS $$
BEGIN
  PERFORM central_agent_manager.assert_session_identity();
  IF session_user::text IS DISTINCT FROM 'central_agent_manager_executor' THEN
    RAISE EXCEPTION 'approval_executor_required';
  END IF;
END;
$$;

CREATE FUNCTION central_agent_manager.reject_task_plan_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'task_plan_is_immutable';
  END IF;
  IF current_setting('cam.allow_plan_insert', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'task_plan_insert_requires_save_function';
  END IF;
  IF NEW.source_revision IS NOT NULL OR NEW.target_revision IS NOT NULL THEN
    RAISE EXCEPTION 'revision_is_not_part_of_this_contract';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_plans_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON central_agent_manager.task_plans
  FOR EACH ROW EXECUTE FUNCTION central_agent_manager.reject_task_plan_write();

CREATE FUNCTION central_agent_manager.reject_task_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, central_agent_manager
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'task_delete_is_rejected';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF current_setting('cam.allow_task_insert', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'task_insert_requires_save_function';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.record IS DISTINCT FROM OLD.record
     AND (
       current_setting('cam.allow_task_update', true) IS DISTINCT FROM 'on'
       AND current_setting('cam.allow_plan_replacement', true) IS DISTINCT FROM 'on'
       OR EXISTS (
         SELECT 1 FROM central_agent_manager.approvals
         WHERE task_id = OLD.id AND revoked_at IS NULL
       )
     )
  THEN
    RAISE EXCEPTION 'authorization_content_is_frozen';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.plan_digest IS DISTINCT FROM OLD.plan_digest
     OR NEW.specialist_id IS DISTINCT FROM OLD.specialist_id
  THEN
    IF current_setting('cam.allow_plan_replacement', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'task_plan_binding_is_immutable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM central_agent_manager.approvals
      WHERE task_id = OLD.id AND revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'authorization_content_is_frozen';
    END IF;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF current_setting('cam.task_state_to', true) IS DISTINCT FROM NEW.state THEN
      RAISE EXCEPTION 'task_state_transition_rejected';
    END IF;
    IF NOT (
      (OLD.state = 'awaiting_approval' AND NEW.state = 'approved')
      OR (OLD.state = 'approved' AND NEW.state = 'running')
      OR (OLD.state = 'created' AND NEW.state = 'awaiting_approval')
    ) THEN
      RAISE EXCEPTION 'task_state_transition_rejected';
    END IF;
  END IF;
  IF current_setting('cam.allow_plan_replacement', true) IS DISTINCT FROM 'on'
     AND current_setting('cam.allow_task_update', true) IS DISTINCT FROM 'on'
     AND (
       NEW.state IS NOT DISTINCT FROM OLD.state
       OR current_setting('cam.task_state_to', true) IS DISTINCT FROM NEW.state
     )
  THEN
    RAISE EXCEPTION 'task_update_requires_function';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_constrained
  BEFORE INSERT OR UPDATE OR DELETE ON central_agent_manager.tasks
  FOR EACH ROW EXECUTE FUNCTION central_agent_manager.reject_task_write();

CREATE FUNCTION central_agent_manager.reject_approval_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval_delete_is_rejected';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF current_setting('cam.allow_approval_insert', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'approval_insert_requires_issue_function';
    END IF;
    IF NEW.revoked_at IS NOT NULL OR NEW.db_session_user IS DISTINCT FROM session_user::text THEN
      RAISE EXCEPTION 'approval_binding_is_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('cam.allow_revocation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'approval_update_requires_revocation_function';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.plan_digest IS DISTINCT FROM OLD.plan_digest
     OR NEW.task_plan_digest IS DISTINCT FROM OLD.task_plan_digest
     OR NEW.specialist_id IS DISTINCT FROM OLD.specialist_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.owner_username IS DISTINCT FROM OLD.owner_username
     OR NEW.db_session_user IS DISTINCT FROM OLD.db_session_user
     OR NEW.decision IS DISTINCT FROM OLD.decision
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'approval_binding_is_immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'revocation_is_permanent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approvals_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON central_agent_manager.approvals
  FOR EACH ROW EXECUTE FUNCTION central_agent_manager.reject_approval_write();

CREATE FUNCTION central_agent_manager.reject_event_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'approval_event_is_append_only';
  END IF;
  IF current_setting('cam.allow_event_insert', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'approval_event_requires_function';
  END IF;
  IF NEW.actor IS DISTINCT FROM session_user::text THEN
    RAISE EXCEPTION 'approval_event_actor_rejected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_events_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON central_agent_manager.approval_events
  FOR EACH ROW EXECUTE FUNCTION central_agent_manager.reject_event_write();

CREATE FUNCTION central_agent_manager.save_task(
  p_task_id text,
  p_plan_version integer,
  p_specialist_id text,
  p_state text,
  p_record jsonb,
  p_requested_operations text[],
  p_allowed_capability_scope text[],
  p_model_calls integer,
  p_tokens integer,
  p_cost_usd integer,
  p_duration_ms integer,
  p_repairs integer,
  p_file_changes integer,
  p_concurrent_sessions integer,
  p_validation_required boolean,
  p_isolation text,
  p_prohibitions text[],
  p_updated_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, central_agent_manager
AS $$
DECLARE
  v_task central_agent_manager.tasks%ROWTYPE;
  v_exists boolean;
  v_digest text;
BEGIN
  PERFORM central_agent_manager.assert_approval_authority();
  IF p_state NOT IN ('created', 'awaiting_approval') OR p_record IS NULL THEN
    RAISE EXCEPTION 'task_contract_rejected';
  END IF;
  v_digest := central_agent_manager.sha256_hex(central_agent_manager.canonical_task_json(
    p_task_id, p_plan_version, p_specialist_id, p_requested_operations, p_allowed_capability_scope,
    p_model_calls, p_tokens, p_cost_usd, p_duration_ms, p_repairs, p_file_changes,
    p_concurrent_sessions, p_validation_required, p_isolation, p_prohibitions
  ));
  SELECT * INTO v_task FROM central_agent_manager.tasks WHERE id = p_task_id FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND EXISTS (
    SELECT 1 FROM central_agent_manager.approvals
    WHERE task_id = p_task_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'authorization_content_is_frozen';
  END IF;
  PERFORM set_config('cam.allow_plan_insert', 'on', true);
  INSERT INTO central_agent_manager.task_plans (
    task_id, plan_version, plan_digest, specialist_id, requested_operations, allowed_capability_scope,
    budget_model_calls, budget_tokens, budget_cost_usd, budget_duration_ms, budget_repairs,
    budget_file_changes, budget_concurrent_sessions, validation_required, isolation, prohibitions,
    source_revision, target_revision, created_at
  ) VALUES (
    p_task_id, p_plan_version, v_digest, p_specialist_id, p_requested_operations, p_allowed_capability_scope,
    p_model_calls, p_tokens, p_cost_usd, p_duration_ms, p_repairs, p_file_changes, p_concurrent_sessions,
    p_validation_required, p_isolation, p_prohibitions, NULL, NULL, p_updated_at
  ) ON CONFLICT (task_id, plan_version, plan_digest) DO NOTHING;
  IF NOT v_exists THEN
    PERFORM set_config('cam.allow_task_insert', 'on', true);
    INSERT INTO central_agent_manager.tasks (
      id, plan_version, plan_digest, specialist_id, state, record, updated_at
    ) VALUES (
      p_task_id, p_plan_version, v_digest, p_specialist_id, p_state, p_record, p_updated_at
    );
    PERFORM set_config('cam.allow_plan_insert', 'off', true);
    PERFORM set_config('cam.allow_task_insert', 'off', true);
    PERFORM set_config('cam.task_state_to', NULL, true);
    RETURN;
  END IF;
  IF v_task.plan_digest IS DISTINCT FROM v_digest
     OR v_task.plan_version IS DISTINCT FROM p_plan_version
     OR v_task.specialist_id IS DISTINCT FROM p_specialist_id
  THEN
    IF v_task.state NOT IN ('created', 'awaiting_approval') THEN
      RAISE EXCEPTION 'task_plan_binding_is_immutable';
    END IF;
    IF p_state IS DISTINCT FROM v_task.state
       AND NOT (v_task.state = 'created' AND p_state = 'awaiting_approval') THEN
      RAISE EXCEPTION 'task_state_transition_rejected';
    END IF;
    PERFORM set_config('cam.allow_plan_replacement', 'on', true);
  ELSIF p_state IS DISTINCT FROM v_task.state
        AND NOT (v_task.state = 'created' AND p_state = 'awaiting_approval') THEN
    RAISE EXCEPTION 'task_state_transition_rejected';
  ELSE
    PERFORM set_config('cam.allow_task_update', 'on', true);
  END IF;
  IF p_state IS DISTINCT FROM v_task.state THEN
    PERFORM set_config('cam.task_state_to', p_state, true);
  END IF;
  UPDATE central_agent_manager.tasks
     SET plan_version = p_plan_version,
         plan_digest = v_digest,
         specialist_id = p_specialist_id,
         state = p_state,
         record = p_record,
         updated_at = p_updated_at
   WHERE id = p_task_id;
  PERFORM set_config('cam.allow_plan_insert', 'off', true);
  PERFORM set_config('cam.allow_plan_replacement', 'off', true);
  PERFORM set_config('cam.allow_task_update', 'off', true);
  PERFORM set_config('cam.task_state_to', NULL, true);
END;
$$;

CREATE FUNCTION central_agent_manager.issue_owner_approval(
  p_approval_id text,
  p_task_id text,
  p_operation text,
  p_environment text,
  p_owner_username text,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_idempotency_key text
) RETURNS central_agent_manager.approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, central_agent_manager
AS $$
DECLARE
  v_task central_agent_manager.tasks%ROWTYPE;
  v_plan central_agent_manager.task_plans%ROWTYPE;
  v_existing central_agent_manager.approvals%ROWTYPE;
  v_task_digest text;
  v_plan_digest text;
BEGIN
  PERFORM central_agent_manager.assert_approval_authority();
  IF p_approval_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_task_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_owner_username !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_environment !~ '^[A-Za-z0-9_.-]{1,40}$'
     OR p_operation NOT IN (
       'external_publish', 'send_notification', 'modify_live_schedule',
       'merge_main', 'production_deploy', 'production_secrets', 'destructive_database',
       'auth_security', 'payments', 'production_infrastructure'
     )
     OR p_issued_at < clock_timestamp() - interval '5 minutes'
     OR p_issued_at > clock_timestamp() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'approval_contract_rejected';
  END IF;
  SELECT * INTO v_task FROM central_agent_manager.tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_missing';
  END IF;
  SELECT * INTO v_plan
    FROM central_agent_manager.task_plans
   WHERE task_id = v_task.id
     AND plan_version = v_task.plan_version
     AND plan_digest = v_task.plan_digest
     AND specialist_id = v_task.specialist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_row_missing';
  END IF;
  IF NOT (p_operation = ANY (v_plan.requested_operations))
     OR NOT (p_operation = ANY (v_plan.allowed_capability_scope))
  THEN
    RAISE EXCEPTION 'operation_not_in_plan';
  END IF;
  v_task_digest := central_agent_manager.sha256_hex(central_agent_manager.canonical_task_json(
    v_plan.task_id, v_plan.plan_version, v_plan.specialist_id, v_plan.requested_operations,
    v_plan.allowed_capability_scope, v_plan.budget_model_calls, v_plan.budget_tokens,
    v_plan.budget_cost_usd, v_plan.budget_duration_ms, v_plan.budget_repairs,
    v_plan.budget_file_changes, v_plan.budget_concurrent_sessions, v_plan.validation_required,
    v_plan.isolation, v_plan.prohibitions
  ));
  v_plan_digest := central_agent_manager.sha256_hex(central_agent_manager.canonical_approval_json(
    v_plan.task_id, v_plan.plan_version, v_plan.specialist_id, v_plan.requested_operations,
    v_plan.allowed_capability_scope, v_plan.budget_model_calls, v_plan.budget_tokens,
    v_plan.budget_cost_usd, v_plan.budget_duration_ms, v_plan.budget_repairs,
    v_plan.budget_file_changes, v_plan.budget_concurrent_sessions, v_plan.validation_required,
    v_plan.isolation, v_plan.prohibitions, p_operation, p_environment
  ));
  IF v_task.plan_digest IS DISTINCT FROM v_task_digest THEN
    RAISE EXCEPTION 'plan_mismatch';
  END IF;
  SELECT * INTO v_existing
    FROM central_agent_manager.approvals
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.task_id IS DISTINCT FROM p_task_id
       OR v_existing.operation IS DISTINCT FROM p_operation
       OR v_existing.plan_version IS DISTINCT FROM v_task.plan_version
       OR v_existing.plan_digest IS DISTINCT FROM v_plan_digest
       OR v_existing.task_plan_digest IS DISTINCT FROM v_task_digest
       OR v_existing.specialist_id IS DISTINCT FROM v_task.specialist_id
       OR v_existing.environment IS DISTINCT FROM p_environment
       OR v_existing.owner_username IS DISTINCT FROM p_owner_username
       OR v_existing.db_session_user IS DISTINCT FROM session_user::text
    THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    IF v_existing.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'approval_replay_revoked';
    END IF;
    IF v_existing.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'approval_replay_expired';
    END IF;
    RETURN v_existing;
  END IF;
  IF v_task.state IS DISTINCT FROM 'awaiting_approval' THEN
    RAISE EXCEPTION 'task_state_mismatch';
  END IF;
  IF p_expires_at <= p_issued_at OR p_expires_at > p_issued_at + interval '24 hours' THEN
    RAISE EXCEPTION 'expiry_window';
  END IF;
  PERFORM set_config('cam.allow_approval_insert', 'on', true);
  PERFORM set_config('cam.allow_event_insert', 'on', true);
  PERFORM set_config('cam.task_state_to', 'approved', true);
  INSERT INTO central_agent_manager.approvals (
    id, task_id, operation, plan_version, plan_digest, task_plan_digest, specialist_id,
    environment, owner_username, db_session_user, decision, issued_at, expires_at,
    revoked_at, idempotency_key
  ) VALUES (
    p_approval_id, p_task_id, p_operation, v_task.plan_version, v_plan_digest, v_task_digest,
    v_task.specialist_id, p_environment, p_owner_username, session_user::text, 'approved',
    p_issued_at, p_expires_at, NULL, p_idempotency_key
  );
  INSERT INTO central_agent_manager.approval_events (approval_id, event, at, actor)
  VALUES (p_approval_id, 'issued', p_issued_at, session_user::text);
  UPDATE central_agent_manager.tasks
     SET state = 'approved', updated_at = p_issued_at
   WHERE id = p_task_id;
  PERFORM set_config('cam.allow_approval_insert', 'off', true);
  PERFORM set_config('cam.allow_event_insert', 'off', true);
  PERFORM set_config('cam.task_state_to', NULL, true);
  SELECT * INTO v_existing FROM central_agent_manager.approvals WHERE id = p_approval_id;
  RETURN v_existing;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'conflicting_live_approval';
END;
$$;

CREATE FUNCTION central_agent_manager.revoke_owner_approval(
  p_approval_id text,
  p_revoked_at timestamptz
) RETURNS central_agent_manager.approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, central_agent_manager
AS $$
DECLARE
  v_row central_agent_manager.approvals%ROWTYPE;
BEGIN
  PERFORM central_agent_manager.assert_approval_authority();
  IF p_approval_id !~ '^[A-Za-z0-9_.-]{1,80}$'
     OR p_revoked_at IS NULL
     OR p_revoked_at < clock_timestamp() - interval '5 minutes'
     OR p_revoked_at > clock_timestamp() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'revocation_contract_rejected';
  END IF;
  SELECT * INTO v_row FROM central_agent_manager.approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_missing';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'revocation_is_permanent';
  END IF;
  PERFORM set_config('cam.allow_revocation', 'on', true);
  PERFORM set_config('cam.allow_event_insert', 'on', true);
  UPDATE central_agent_manager.approvals
     SET revoked_at = p_revoked_at
   WHERE id = p_approval_id;
  INSERT INTO central_agent_manager.approval_events (approval_id, event, at, actor)
  VALUES (p_approval_id, 'revoked', p_revoked_at, session_user::text);
  PERFORM set_config('cam.allow_revocation', 'off', true);
  PERFORM set_config('cam.allow_event_insert', 'off', true);
  PERFORM set_config('cam.task_state_to', NULL, true);
  SELECT * INTO v_row FROM central_agent_manager.approvals WHERE id = p_approval_id;
  RETURN v_row;
END;
$$;

CREATE FUNCTION central_agent_manager.mark_task_running(
  p_task_id text,
  p_operation text,
  p_environment text,
  p_updated_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, central_agent_manager
AS $$
DECLARE
  v_task central_agent_manager.tasks%ROWTYPE;
  v_plan central_agent_manager.task_plans%ROWTYPE;
  v_task_digest text;
  v_plan_digest text;
BEGIN
  PERFORM central_agent_manager.assert_executor();
  IF p_task_id !~ '^[A-Za-z0-9_.-]{1,80}$' OR p_environment !~ '^[A-Za-z0-9_.-]{1,40}$' THEN
    RAISE EXCEPTION 'task_state_mismatch';
  END IF;
  SELECT * INTO v_task FROM central_agent_manager.tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR v_task.state IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'task_state_mismatch';
  END IF;
  SELECT * INTO v_plan
    FROM central_agent_manager.task_plans
   WHERE task_id = v_task.id
     AND plan_version = v_task.plan_version
     AND plan_digest = v_task.plan_digest
     AND specialist_id = v_task.specialist_id;
  IF NOT FOUND
     OR NOT (p_operation = ANY (v_plan.requested_operations))
     OR NOT (p_operation = ANY (v_plan.allowed_capability_scope))
  THEN
    RAISE EXCEPTION 'operation_not_in_plan';
  END IF;
  v_task_digest := central_agent_manager.sha256_hex(central_agent_manager.canonical_task_json(
    v_plan.task_id, v_plan.plan_version, v_plan.specialist_id, v_plan.requested_operations,
    v_plan.allowed_capability_scope, v_plan.budget_model_calls, v_plan.budget_tokens,
    v_plan.budget_cost_usd, v_plan.budget_duration_ms, v_plan.budget_repairs,
    v_plan.budget_file_changes, v_plan.budget_concurrent_sessions, v_plan.validation_required,
    v_plan.isolation, v_plan.prohibitions
  ));
  v_plan_digest := central_agent_manager.sha256_hex(central_agent_manager.canonical_approval_json(
    v_plan.task_id, v_plan.plan_version, v_plan.specialist_id, v_plan.requested_operations,
    v_plan.allowed_capability_scope, v_plan.budget_model_calls, v_plan.budget_tokens,
    v_plan.budget_cost_usd, v_plan.budget_duration_ms, v_plan.budget_repairs,
    v_plan.budget_file_changes, v_plan.budget_concurrent_sessions, v_plan.validation_required,
    v_plan.isolation, v_plan.prohibitions, p_operation, p_environment
  ));
  IF v_task.plan_digest IS DISTINCT FROM v_task_digest THEN
    RAISE EXCEPTION 'plan_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM central_agent_manager.approvals
    WHERE task_id = v_task.id
      AND operation = p_operation
      AND environment = p_environment
      AND plan_version = v_task.plan_version
      AND plan_digest = v_plan_digest
      AND task_plan_digest = v_task_digest
      AND specialist_id = v_task.specialist_id
      AND revoked_at IS NULL
      AND expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'approval_not_live';
  END IF;
  PERFORM set_config('cam.task_state_to', 'running', true);
  UPDATE central_agent_manager.tasks
     SET state = 'running', updated_at = p_updated_at
   WHERE id = p_task_id;
  PERFORM set_config('cam.task_state_to', NULL, true);
END;
$$;

REVOKE ALL ON FUNCTION central_agent_manager.json_number(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.json_string_array(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.sha256_hex(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.canonical_task_json(
  text, integer, text, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.canonical_approval_json(
  text, integer, text, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[], text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.assert_session_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.assert_approval_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.assert_executor() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.reject_task_plan_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.reject_task_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.reject_approval_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.reject_event_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.save_task(
  text, integer, text, text, jsonb, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[], timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.issue_owner_approval(
  text, text, text, text, text, timestamptz, timestamptz, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.revoke_owner_approval(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION central_agent_manager.mark_task_running(text, text, text, timestamptz) FROM PUBLIC;

GRANT USAGE ON SCHEMA central_agent_manager TO central_agent_manager_approval_authority, central_agent_manager_executor;
REVOKE CREATE ON SCHEMA central_agent_manager FROM central_agent_manager_approval_authority, central_agent_manager_executor;
REVOKE ALL ON ALL TABLES IN SCHEMA central_agent_manager FROM PUBLIC, central_agent_manager_approval_authority, central_agent_manager_executor;
GRANT SELECT ON ALL TABLES IN SCHEMA central_agent_manager TO central_agent_manager_approval_authority, central_agent_manager_executor;
GRANT EXECUTE ON FUNCTION central_agent_manager.save_task(
  text, integer, text, text, jsonb, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[], timestamptz
) TO central_agent_manager_approval_authority;
GRANT EXECUTE ON FUNCTION central_agent_manager.issue_owner_approval(
  text, text, text, text, text, timestamptz, timestamptz, text
) TO central_agent_manager_approval_authority;
GRANT EXECUTE ON FUNCTION central_agent_manager.revoke_owner_approval(text, timestamptz)
  TO central_agent_manager_approval_authority;
GRANT EXECUTE ON FUNCTION central_agent_manager.mark_task_running(text, text, text, timestamptz)
  TO central_agent_manager_executor;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA central_agent_manager TO central_agent_manager_approval_owner;

ALTER TABLE central_agent_manager.task_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.task_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_agent_manager.approval_events FORCE ROW LEVEL SECURITY;

CREATE POLICY task_plans_select ON central_agent_manager.task_plans FOR SELECT USING (true);
CREATE POLICY task_plans_insert ON central_agent_manager.task_plans FOR INSERT
  WITH CHECK (current_setting('cam.allow_plan_insert', true) = 'on');
CREATE POLICY tasks_select ON central_agent_manager.tasks FOR SELECT USING (true);
CREATE POLICY tasks_insert ON central_agent_manager.tasks FOR INSERT
  WITH CHECK (current_setting('cam.allow_task_insert', true) = 'on');
CREATE POLICY tasks_update ON central_agent_manager.tasks FOR UPDATE
  USING (
    current_setting('cam.allow_plan_replacement', true) = 'on'
    OR current_setting('cam.allow_task_update', true) = 'on'
    OR current_setting('cam.task_state_to', true) IS NOT NULL
  )
  WITH CHECK (
    current_setting('cam.allow_plan_replacement', true) = 'on'
    OR current_setting('cam.allow_task_update', true) = 'on'
    OR current_setting('cam.task_state_to', true) IS NOT NULL
  );
CREATE POLICY approvals_select ON central_agent_manager.approvals FOR SELECT USING (true);
CREATE POLICY approvals_insert ON central_agent_manager.approvals FOR INSERT
  WITH CHECK (current_setting('cam.allow_approval_insert', true) = 'on');
CREATE POLICY approvals_update ON central_agent_manager.approvals FOR UPDATE
  USING (current_setting('cam.allow_revocation', true) = 'on')
  WITH CHECK (current_setting('cam.allow_revocation', true) = 'on');
CREATE POLICY approval_events_select ON central_agent_manager.approval_events FOR SELECT USING (true);
CREATE POLICY approval_events_insert ON central_agent_manager.approval_events FOR INSERT
  WITH CHECK (current_setting('cam.allow_event_insert', true) = 'on');

ALTER TABLE central_agent_manager.task_plans OWNER TO central_agent_manager_approval_owner;
ALTER TABLE central_agent_manager.tasks OWNER TO central_agent_manager_approval_owner;
ALTER TABLE central_agent_manager.approvals OWNER TO central_agent_manager_approval_owner;
ALTER TABLE central_agent_manager.approval_events OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.json_number(numeric) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.json_string_array(text[]) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.sha256_hex(text) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.canonical_task_json(
  text, integer, text, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[]
) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.canonical_approval_json(
  text, integer, text, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[], text, text
) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.assert_session_identity() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.assert_approval_authority() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.assert_executor() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.reject_task_plan_write() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.reject_task_write() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.reject_approval_write() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.reject_event_write() OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.save_task(
  text, integer, text, text, jsonb, text[], text[], integer, integer, integer, integer, integer, integer, integer, boolean, text, text[], timestamptz
) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.issue_owner_approval(
  text, text, text, text, text, timestamptz, timestamptz, text
) OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.revoke_owner_approval(text, timestamptz)
  OWNER TO central_agent_manager_approval_owner;
ALTER FUNCTION central_agent_manager.mark_task_running(text, text, text, timestamptz)
  OWNER TO central_agent_manager_approval_owner;

REVOKE central_agent_manager_approval_owner FROM CURRENT_USER;

DO $audit$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN (
      'central_agent_manager_executor',
      'central_agent_manager_approval_authority',
      'central_agent_manager_approval_owner'
    )
    AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'approval_role_privileges_rejected';
  END IF;
  IF pg_has_role(current_user, 'central_agent_manager_approval_owner', 'member')
     OR pg_has_role('central_agent_manager_executor', 'central_agent_manager_approval_authority', 'member')
     OR pg_has_role('central_agent_manager_executor', 'central_agent_manager_approval_owner', 'member')
     OR pg_has_role('central_agent_manager_approval_authority', 'central_agent_manager_executor', 'member')
     OR pg_has_role('central_agent_manager_approval_authority', 'central_agent_manager_approval_owner', 'member')
  THEN
    RAISE EXCEPTION 'approval_role_membership_rejected';
  END IF;
  IF has_function_privilege('public', 'central_agent_manager.issue_owner_approval(text,text,text,text,text,timestamptz,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('public', 'central_agent_manager.revoke_owner_approval(text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('public', 'central_agent_manager.save_task(text,integer,text,text,jsonb,text[],text[],integer,integer,integer,integer,integer,integer,integer,boolean,text,text[],timestamptz)', 'EXECUTE')
     OR has_function_privilege('public', 'central_agent_manager.mark_task_running(text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('central_agent_manager_executor', 'central_agent_manager.issue_owner_approval(text,text,text,text,text,timestamptz,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('central_agent_manager_executor', 'central_agent_manager.revoke_owner_approval(text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('central_agent_manager_executor', 'central_agent_manager.save_task(text,integer,text,text,jsonb,text[],text[],integer,integer,integer,integer,integer,integer,integer,boolean,text,text[],timestamptz)', 'EXECUTE')
     OR has_function_privilege('central_agent_manager_approval_authority', 'central_agent_manager.mark_task_running(text,text,text,timestamptz)', 'EXECUTE')
     OR has_table_privilege('central_agent_manager_executor', 'central_agent_manager.approvals', 'INSERT')
     OR has_table_privilege('central_agent_manager_executor', 'central_agent_manager.approvals', 'UPDATE')
     OR has_table_privilege('central_agent_manager_executor', 'central_agent_manager.approvals', 'DELETE')
     OR has_table_privilege('central_agent_manager_approval_authority', 'central_agent_manager.approvals', 'INSERT')
     OR has_table_privilege('central_agent_manager_approval_authority', 'central_agent_manager.approvals', 'UPDATE')
     OR has_table_privilege('central_agent_manager_approval_authority', 'central_agent_manager.approvals', 'DELETE')
  THEN
    RAISE EXCEPTION 'approval_privilege_audit_rejected';
  END IF;
  IF NOT has_function_privilege('central_agent_manager_approval_authority', 'central_agent_manager.issue_owner_approval(text,text,text,text,text,timestamptz,timestamptz,text)', 'EXECUTE')
     OR NOT has_function_privilege('central_agent_manager_executor', 'central_agent_manager.mark_task_running(text,text,text,timestamptz)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'approval_privilege_audit_rejected';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl
    WHERE relation.relkind IN ('r', 'v', 'm', 'p', 'f')
      AND (
        (
          acl.grantee = 0
          AND schema.nspname = 'public'
          AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'SELECT')
        )
        OR (
          schema.nspname IS DISTINCT FROM 'central_agent_manager'
          AND acl.grantee IN (
            SELECT oid FROM pg_roles
            WHERE rolname IN (
              'central_agent_manager_executor',
              'central_agent_manager_approval_authority'
            )
          )
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_default_acl AS defaults
    JOIN pg_namespace AS schema ON schema.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
    WHERE schema.nspname = 'public'
      AND acl.grantee = 0
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'SELECT')
  ) THEN
    RAISE EXCEPTION 'approval_inherited_grant_rejected';
  END IF;
END
$audit$;
COMMIT;
