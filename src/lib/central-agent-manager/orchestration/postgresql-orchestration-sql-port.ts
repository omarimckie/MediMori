import type { OrchestrationSqlPort, OrchestrationSqlQuarantineRow, OrchestrationSqlRow } from "./orchestration-sql-port";
import type { PostgresqlSqlClient, PostgresqlTransactionalClient } from "./postgresql-sql-client";

const SCHEMA = "central_agent_manager";

function rowFromDb(row: Record<string, unknown>): OrchestrationSqlRow {
  return {
    id: String(row.id),
    payload_json: typeof row.payload_json === "string" ? row.payload_json : JSON.stringify(row.payload_json),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

/**
 * Parameterized PostgreSQL implementation of OrchestrationSqlPort.
 * Caller supplies a connected client (PGlite in tests, pool in production after owner activation).
 */
export function createPostgresqlOrchestrationSqlPort(client: PostgresqlTransactionalClient): OrchestrationSqlPort {
  return {
    async withTransaction(work) {
      return client.withTransaction((tx) => work(createTxPort(tx)));
    },
    loadJobs: () => loadTable(client, `${SCHEMA}.orchestration_jobs`),
    loadAssignments: () => loadTable(client, `${SCHEMA}.orchestration_assignments`),
    loadAgents: () => loadTable(client, `${SCHEMA}.orchestration_agents`),
    loadQuarantined: () => loadQuarantine(client),
    upsertJob: (row) => upsertJob(client, row),
    upsertJobIfOwnerWritable: (row) => upsertJobIfOwnerWritable(client, row),
    upsertAssignment: (row) => upsertAssignment(client, row),
    upsertAgent: (row) => upsertAgent(client, row),
    deleteJob: async (id) => {
      await client.query(`DELETE FROM ${SCHEMA}.orchestration_jobs WHERE id = $1`, [id]);
    },
    quarantineRecord: (row) => quarantine(client, row),
    tryClaimReadyJob: (input) => tryClaimReadyJob(client, input),
    renewAssignmentLease: (input) => renewAssignmentLease(client, input),
    updateAssignmentWithJobIfFence: (input) => updateAssignmentWithJobIfFence(client, input),
    completeAssignmentIdempotent: (input) => completeAssignmentIdempotent(client, input),
  };
}

function createTxPort(tx: PostgresqlSqlClient): OrchestrationSqlPort {
  return {
    withTransaction: (work) => work(createTxPort(tx)),
    loadJobs: () => loadTable(tx, `${SCHEMA}.orchestration_jobs`),
    loadAssignments: () => loadTable(tx, `${SCHEMA}.orchestration_assignments`),
    loadAgents: () => loadTable(tx, `${SCHEMA}.orchestration_agents`),
    loadQuarantined: () => loadQuarantine(tx),
    upsertJob: (row) => upsertJob(tx, row),
    upsertJobIfOwnerWritable: (row) => upsertJobIfOwnerWritable(tx, row),
    upsertAssignment: (row) => upsertAssignment(tx, row),
    upsertAgent: (row) => upsertAgent(tx, row),
    deleteJob: async (id) => {
      await tx.query(`DELETE FROM ${SCHEMA}.orchestration_jobs WHERE id = $1`, [id]);
    },
    quarantineRecord: (row) => quarantine(tx, row),
    tryClaimReadyJob: (input) => claimReadyJobInTransaction(tx, input),
    renewAssignmentLease: (input) => renewAssignmentLease(tx, input),
    updateAssignmentWithJobIfFence: (input) => updateAssignmentWithJobIfFenceInTransaction(tx, input),
    completeAssignmentIdempotent: (input) => completeAssignmentInTransaction(tx, input),
  };
}

async function loadTable(client: PostgresqlSqlClient, table: string): Promise<OrchestrationSqlRow[]> {
  const result = await client.query(`SELECT id, payload_json, updated_at FROM ${table} ORDER BY id`);
  return result.rows.map(rowFromDb);
}

async function loadQuarantine(client: PostgresqlSqlClient): Promise<OrchestrationSqlQuarantineRow[]> {
  const result = await client.query(
    `SELECT id, source_table, payload_json, reason, quarantined_at FROM ${SCHEMA}.orchestration_quarantine ORDER BY quarantined_at`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    source_table: String(row.source_table),
    payload_json: typeof row.payload_json === "string" ? row.payload_json : JSON.stringify(row.payload_json),
    reason: String(row.reason),
    quarantined_at: new Date(String(row.quarantined_at)).toISOString(),
  }));
}

async function upsertJob(client: PostgresqlSqlClient, row: OrchestrationSqlRow): Promise<void> {
  await client.query(
    `INSERT INTO ${SCHEMA}.orchestration_jobs (id, payload_json, updated_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (id) DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at`,
    [row.id, row.payload_json, row.updated_at],
  );
}

async function upsertJobIfOwnerWritable(client: PostgresqlSqlClient, row: OrchestrationSqlRow): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO ${SCHEMA}.orchestration_jobs (id, payload_json, updated_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (id) DO UPDATE
     SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at
     WHERE (
       ${SCHEMA}.orchestration_jobs.payload_json->>'state' NOT IN ('running', 'assigned')
       AND NOT EXISTS (
         SELECT 1 FROM ${SCHEMA}.orchestration_assignments a
         WHERE a.job_id = ${SCHEMA}.orchestration_jobs.id
           AND a.payload_json->>'state' = 'active'
       )
     )
     RETURNING id`,
    [row.id, row.payload_json, row.updated_at],
  );
  return result.rows.length > 0;
}

async function upsertAssignment(client: PostgresqlSqlClient, row: OrchestrationSqlRow & { job_id?: string }): Promise<void> {
  const jobId =
    row.job_id ??
    (JSON.parse(row.payload_json) as { jobId?: string }).jobId ??
    (() => {
      throw new Error("Assignment row is missing job_id.");
    })();
  await client.query(
    `INSERT INTO ${SCHEMA}.orchestration_assignments (id, job_id, payload_json, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)
     ON CONFLICT (id) DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at, job_id = EXCLUDED.job_id`,
    [row.id, jobId, row.payload_json, row.updated_at],
  );
}

async function upsertAgent(client: PostgresqlSqlClient, row: OrchestrationSqlRow): Promise<void> {
  await client.query(
    `INSERT INTO ${SCHEMA}.orchestration_agents (id, payload_json, updated_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (id) DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at`,
    [row.id, row.payload_json, row.updated_at],
  );
}

async function quarantine(client: PostgresqlSqlClient, row: OrchestrationSqlQuarantineRow): Promise<void> {
  await client.query(
    `INSERT INTO ${SCHEMA}.orchestration_quarantine (id, source_table, payload_json, reason, quarantined_at)
     VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
     ON CONFLICT (id) DO UPDATE SET payload_json = EXCLUDED.payload_json, reason = EXCLUDED.reason, quarantined_at = EXCLUDED.quarantined_at`,
    [row.id, row.source_table, row.payload_json, row.reason, row.quarantined_at],
  );
}

async function claimReadyJobInTransaction(
  tx: PostgresqlSqlClient,
  input: {
    jobId: string;
    jobJson: string;
    assignmentId: string;
    assignmentJson: string;
    assignmentJobId: string;
    now: string;
  },
): Promise<boolean> {
  const current = await tx.query<{ payload_json: unknown }>(
    `SELECT payload_json FROM ${SCHEMA}.orchestration_jobs WHERE id = $1 FOR UPDATE`,
    [input.jobId],
  );
  if (!current.rows.length) return false;
  const payload =
    typeof current.rows[0].payload_json === "string"
      ? current.rows[0].payload_json
      : JSON.stringify(current.rows[0].payload_json);
  const state = (JSON.parse(payload) as { state?: string }).state;
  if (state !== "ready") return false;
  const active = await tx.query(
    `SELECT id FROM ${SCHEMA}.orchestration_assignments
     WHERE job_id = $1 AND payload_json->>'state' = 'active' LIMIT 1`,
    [input.jobId],
  );
  if (active.rows.length > 0) return false;
  await upsertJob(tx, { id: input.jobId, payload_json: input.jobJson, updated_at: input.now });
  await upsertAssignment(tx, {
    id: input.assignmentId,
    job_id: input.assignmentJobId,
    payload_json: input.assignmentJson,
    updated_at: input.now,
  });
  return true;
}

async function tryClaimReadyJob(
  client: PostgresqlTransactionalClient,
  input: {
    jobId: string;
    jobJson: string;
    assignmentId: string;
    assignmentJson: string;
    assignmentJobId: string;
    now: string;
  },
): Promise<boolean> {
  return client.withTransaction((tx) => claimReadyJobInTransaction(tx, input));
}

async function updateAssignmentWithJobIfFence(
  client: PostgresqlTransactionalClient,
  input: {
    assignmentId: string;
    assignmentJson: string;
    fenceToken: number;
    jobId: string;
    jobJson: string;
    now: string;
    allowedAssignmentStates?: readonly string[];
  },
): Promise<boolean> {
  return client.withTransaction((tx) => updateAssignmentWithJobIfFenceInTransaction(tx, input));
}

async function updateAssignmentWithJobIfFenceInTransaction(
  tx: PostgresqlSqlClient,
  input: {
    assignmentId: string;
    assignmentJson: string;
    fenceToken: number;
    jobId: string;
    jobJson: string;
    now: string;
    allowedAssignmentStates?: readonly string[];
  },
): Promise<boolean> {
  const assignment = await tx.query<{ payload_json: unknown }>(
    `SELECT payload_json FROM ${SCHEMA}.orchestration_assignments WHERE id = $1 FOR UPDATE`,
    [input.assignmentId],
  );
  if (!assignment.rows.length) return false;
  const assignmentPayload =
    typeof assignment.rows[0].payload_json === "string"
      ? assignment.rows[0].payload_json
      : JSON.stringify(assignment.rows[0].payload_json);
  const parsed = JSON.parse(assignmentPayload) as { state?: string; lease?: { fenceToken?: number } };
  if (parsed.lease?.fenceToken !== input.fenceToken) return false;
  if (
    input.allowedAssignmentStates?.length &&
    (!parsed.state || !input.allowedAssignmentStates.includes(parsed.state))
  ) {
    return false;
  }
  await upsertAssignment(tx, {
    id: input.assignmentId,
    job_id: input.jobId,
    payload_json: input.assignmentJson,
    updated_at: input.now,
  });
  await upsertJob(tx, { id: input.jobId, payload_json: input.jobJson, updated_at: input.now });
  return true;
}

async function renewAssignmentLease(
  client: PostgresqlSqlClient,
  input: { assignmentId: string; assignmentJson: string; fenceToken: number; now: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE ${SCHEMA}.orchestration_assignments
     SET payload_json = $2::jsonb, updated_at = $3::timestamptz
     WHERE id = $1
       AND payload_json->>'state' = 'active'
       AND (payload_json->'lease'->>'fenceToken')::int = $4
     RETURNING id`,
    [input.assignmentId, input.assignmentJson, input.now, input.fenceToken],
  );
  return result.rows.length > 0;
}

async function completeAssignmentInTransaction(
  tx: PostgresqlSqlClient,
  input: {
    assignmentId: string;
    assignmentJson: string;
    jobId: string;
    jobJson: string;
    fenceToken: number;
    now: string;
  },
): Promise<"completed" | "already_completed" | "rejected"> {
  const assignment = await tx.query<{ payload_json: unknown }>(
    `SELECT payload_json FROM ${SCHEMA}.orchestration_assignments WHERE id = $1 FOR UPDATE`,
    [input.assignmentId],
  );
  if (!assignment.rows.length) return "rejected";
  const assignmentPayload =
    typeof assignment.rows[0].payload_json === "string"
      ? assignment.rows[0].payload_json
      : JSON.stringify(assignment.rows[0].payload_json);
  const parsed = JSON.parse(assignmentPayload) as { state?: string; lease?: { fenceToken?: number } };
  if (parsed.state === "completed") return "already_completed";
  if (parsed.state !== "active" || parsed.lease?.fenceToken !== input.fenceToken) return "rejected";
  await upsertAssignment(tx, {
    id: input.assignmentId,
    job_id: input.jobId,
    payload_json: input.assignmentJson,
    updated_at: input.now,
  });
  await upsertJob(tx, { id: input.jobId, payload_json: input.jobJson, updated_at: input.now });
  return "completed";
}

async function completeAssignmentIdempotent(
  client: PostgresqlTransactionalClient,
  input: {
    assignmentId: string;
    assignmentJson: string;
    jobId: string;
    jobJson: string;
    fenceToken: number;
    now: string;
  },
): Promise<"completed" | "already_completed" | "rejected"> {
  return client.withTransaction((tx) => completeAssignmentInTransaction(tx, input));
}
