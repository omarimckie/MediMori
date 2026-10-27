import { Pool } from "@neondatabase/serverless";
import type { PostgresqlQueryResult, PostgresqlSqlClient, PostgresqlTransactionalClient } from "./postgresql-sql-client";

/**
 * Pooled PostgreSQL client for orchestration (interactive transactions).
 * Only construct when owner explicitly enables CAM_ORCHESTRATION_POOL_ENABLED.
 */
export function createNeonOrchestrationTransactionalClient(connectionString: string): PostgresqlTransactionalClient {
  const pool = new Pool({ connectionString });
  return {
    query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<PostgresqlQueryResult<Row>> => {
      const result = await pool.query(text, params ? [...params] : []);
      return { rows: result.rows as Row[] };
    },
    withTransaction: async (work) => {
      const pgClient = await pool.connect();
      try {
        await pgClient.query("BEGIN");
        const tx: PostgresqlSqlClient = {
          query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
            text: string,
            params?: readonly unknown[],
          ): Promise<PostgresqlQueryResult<Row>> => {
            const result = await pgClient.query(text, params ? [...params] : []);
            return { rows: result.rows as Row[] };
          },
        };
        const outcome = await work(tx);
        await pgClient.query("COMMIT");
        return outcome;
      } catch (error) {
        await pgClient.query("ROLLBACK");
        throw error;
      } finally {
        pgClient.release();
      }
    },
  };
}
