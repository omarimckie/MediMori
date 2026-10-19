# Dispatcher watchdog schema migration

Guarded, operator-invoked migration for `sql/marketing-dispatcher-watchdog.sql`.

This migration is **not** run at application startup. Local code completion does **not** authorize production execution.

## Prerequisite order (production)

Apply **before** this migration:

1. `marketing:schema:incidents`
2. `marketing:schema:incidents-notification-linkage` (when required by your environment)
3. `marketing:schema:dispatcher-qstash-primary` (guarded QStash-primary script)

Then apply the watchdog schema. Watchdog tables reference `marketing_incidents`; the runner refuses execute when that table is missing.

## Execute mode

All of the following are required:

- `MARKETING_DISPATCHER_WATCHDOG_SCHEMA_APPLY_AUTHORIZED=execute`
- `MARKETING_DISPATCHER_WATCHDOG_SCHEMA_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?...`
- `MARKETING_MIGRATION_EXPECTED_PG_HOST=HOST` (exact hostname match)
- `MARKETING_MIGRATION_EXPECTED_PG_DATABASE=DATABASE` (exact database name match)

The script uses **only** `MARKETING_DISPATCHER_WATCHDOG_SCHEMA_DATABASE_URL`.

It does **not** read:

- `DATABASE_URL`
- `.env.local`
- application runtime database pools

Host and database checks are preconnection safeguards. They reduce accidental targeting errors but do **not** prove the intended Neon project or branch. Production migration still requires independent owner authorization and operator review of the actual target.

## Dry-run mode

`MARKETING_DISPATCHER_WATCHDOG_SCHEMA_DRY_RUN=report`

- No execution authorization required.
- No database connection.
- Reports statement count, object names, prerequisite tables, and whether execute variables are **supplied** (not their values).

If both dry-run and execute authorization are set, **dry-run wins** and no connection is made.

## Transaction behavior

- One PostgreSQL transaction (`BEGIN` → prerequisite check → DDL → schema compatibility verification → `COMMIT`).
- Transaction-scoped advisory lock key: `marketing_dispatcher_watchdog_schema_apply`.
- On failure: `ROLLBACK`, sanitized error code, connection released.
- No automatic repair of incompatible existing schemas.

## Package script

`npm run marketing:schema:dispatcher-watchdog` invokes the migration entry point but **refuses execution** without the execute authorization gate.
