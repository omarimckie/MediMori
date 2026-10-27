import type { PostgresqlQueryResult, PostgresqlSqlClient, PostgresqlTransactionalClient } from "./postgresql-sql-client";

type PgliteLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  exec: (script: string) => Promise<unknown>;
};

async function runQuery<Row extends Record<string, unknown> = Record<string, unknown>>(
  db: PgliteLike,
  text: string,
  params?: readonly unknown[],
): Promise<PostgresqlQueryResult<Row>> {
  const result = await db.query(text, params ? [...params] : []);
  return { rows: result.rows as Row[] };
}

export function createPgliteTransactionalClient(db: PgliteLike): PostgresqlTransactionalClient {
  let transactionDepth = 0;
  const client: PostgresqlTransactionalClient = {
    query: (text, params) => runQuery(db, text, params),
    withTransaction: async (work) => {
      if (transactionDepth > 0) {
        const tx: PostgresqlSqlClient = {
          query: (text, params) => runQuery(db, text, params),
        };
        return work(tx);
      }
      transactionDepth += 1;
      await db.query("BEGIN");
      try {
        const tx: PostgresqlSqlClient = {
          query: (text, params) => runQuery(db, text, params),
        };
        const result = await work(tx);
        await db.query("COMMIT");
        return result;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
  };
  return client;
}

export async function applyOrchestrationSchemaToPglite(db: PgliteLike, schemaSql: string): Promise<void> {
  await db.exec(schemaSql);
}
