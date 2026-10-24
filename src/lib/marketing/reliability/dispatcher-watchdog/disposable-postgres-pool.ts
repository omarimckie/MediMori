import type { Pool } from "@neondatabase/serverless";
import {
  createDisposableWatchdogPgPool as createPool,
  DISPOSABLE_WATCHDOG_PG_DRIVER_ID,
  formatDisposablePostgresConnectionError,
} from "../../../../../scripts/dispatcher-watchdog-disposable-postgres-pool.mjs";

export { DISPOSABLE_WATCHDOG_PG_DRIVER_ID, formatDisposablePostgresConnectionError };

export function createDisposableWatchdogPgPool(connectionString: string): Pool {
  return createPool(connectionString) as unknown as Pool;
}
