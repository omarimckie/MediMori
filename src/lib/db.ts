import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sql: NeonQueryFunction<false, false> | null = null;

/**
 * Server-side Neon/Postgres client. Import only from Route Handlers,
 * Server Actions, or other server modules — never from Client Components.
 * DATABASE_URL is never exposed to the browser.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (typeof window !== "undefined") {
    throw new Error("Database client is server-side only.");
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!sql) {
    sql = neon(connectionString);
  }

  return sql;
}
