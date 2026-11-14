import type { NeonQueryFunction } from "@neondatabase/serverless";
import type pg from "pg";

/** Maps tagged SQL to node-pg for disposable local PostgreSQL integration tests. */
export function createDisposableMarketingPgSql(pool: pg.Pool): NeonQueryFunction<false, false> {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    const params: unknown[] = [];
    for (let index = 0; index < strings.length; index += 1) {
      text += strings[index];
      if (index < values.length) {
        params.push(values[index]);
        text += `$${params.length}`;
      }
    }
    const result = await pool.query(text, params);
    return result.rows;
  }) as NeonQueryFunction<false, false>;

  const sql = tag as unknown as NeonQueryFunction<false, false>;
  // @ts-expect-error disposable local pg adapter: Neon’s query() typing expects HTTP promises.
  sql.query = async (queryText: string, params?: unknown[]) => {
    const result = await pool.query(queryText, params);
    return result.rows;
  };

  return sql as unknown as NeonQueryFunction<false, false>;
}