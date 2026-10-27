/** Minimal PostgreSQL client surface for orchestration (injected; no implicit connect). */
export type PostgresqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
};

export type PostgresqlSqlClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<PostgresqlQueryResult<Row>>;
};

export type PostgresqlTransactionalClient = PostgresqlSqlClient & {
  withTransaction<T>(work: (tx: PostgresqlSqlClient) => Promise<T>): Promise<T>;
};
