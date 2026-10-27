import type { ObjectiveOutboxSqlRow, ObjectiveSqlPort, ObjectiveSqlRow } from "../phase6d/objective-sql-port";
import type { PostgresqlSqlClient, PostgresqlTransactionalClient } from "../orchestration/postgresql-sql-client";

const SCHEMA = "central_agent_manager";

function createObjectivePort(client: PostgresqlSqlClient): ObjectiveSqlPort {
  return {
    withTransaction(work) {
      if ("withTransaction" in client && typeof (client as PostgresqlTransactionalClient).withTransaction === "function") {
        return (client as PostgresqlTransactionalClient).withTransaction((tx) => work(createObjectivePort(tx)));
      }
      return work(createObjectivePort(client));
    },
    loadObjectives: async () => {
      const result = await client.query(
        `SELECT objective_id, idempotency_key, record_fence, document_json, checksum, updated_at
         FROM ${SCHEMA}.objective_executions ORDER BY objective_id`,
      );
      return result.rows.map((row) => ({
        objective_id: String(row.objective_id),
        idempotency_key: String(row.idempotency_key),
        record_fence: Number(row.record_fence),
        document_json:
          typeof row.document_json === "string" ? row.document_json : JSON.stringify(row.document_json),
        checksum: String(row.checksum),
        updated_at: new Date(String(row.updated_at)).toISOString(),
      }));
    },
    loadOutbox: async (objectiveId) => {
      const result = objectiveId
        ? await client.query(
            `SELECT id, objective_id, kind, payload_json::text AS payload_json, status, created_at
             FROM ${SCHEMA}.objective_outbox WHERE objective_id = $1 ORDER BY created_at`,
            [objectiveId],
          )
        : await client.query(
            `SELECT id, objective_id, kind, payload_json::text AS payload_json, status, created_at
             FROM ${SCHEMA}.objective_outbox ORDER BY created_at`,
          );
      return result.rows.map((row) => ({
        id: String(row.id),
        objective_id: String(row.objective_id),
        kind: row.kind as ObjectiveOutboxSqlRow["kind"],
        payload_json: String(row.payload_json),
        status: row.status as ObjectiveOutboxSqlRow["status"],
        created_at: new Date(String(row.created_at)).toISOString(),
      }));
    },
    upsertObjective: async ({ row, expectedFence }) => {
      if (expectedFence === null) {
        const insert = await client.query(
          `INSERT INTO ${SCHEMA}.objective_executions
             (objective_id, idempotency_key, record_fence, document_json, checksum, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
           ON CONFLICT (objective_id) DO NOTHING
           RETURNING objective_id`,
          [
            row.objective_id,
            row.idempotency_key,
            row.record_fence,
            row.document_json,
            row.checksum,
            row.updated_at,
          ],
        );
        return insert.rows.length > 0;
      }
      const update = await client.query(
        `UPDATE ${SCHEMA}.objective_executions
         SET idempotency_key = $2, record_fence = $3, document_json = $4, checksum = $5, updated_at = $6::timestamptz
         WHERE objective_id = $1 AND record_fence = $7
         RETURNING objective_id`,
        [
          row.objective_id,
          row.idempotency_key,
          row.record_fence,
          row.document_json,
          row.checksum,
          row.updated_at,
          expectedFence,
        ],
      );
      return update.rows.length > 0;
    },
    insertOutbox: async (row) => {
      await client.query(
        `INSERT INTO ${SCHEMA}.objective_outbox (id, objective_id, kind, payload_json, status, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.objective_id, row.kind, row.payload_json, row.status, row.created_at],
      );
    },
    markOutboxApplied: async (id) => {
      await client.query(`UPDATE ${SCHEMA}.objective_outbox SET status = 'applied' WHERE id = $1`, [id]);
    },
  };
}

export function createPostgresqlObjectiveSqlPort(client: PostgresqlTransactionalClient): ObjectiveSqlPort {
  return createObjectivePort(client);
}
