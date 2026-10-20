# QStash-primary schema migration (H3)

Guarded, operator-invoked migration for `sql/marketing-dispatcher-qstash-primary.sql`.

This migration is **not** run at application startup. Local code completion does **not** authorize production execution.

## Execute mode

All of the following are required:

- `MARKETING_QSTASH_PRIMARY_SCHEMA_APPLY_AUTHORIZED=execute`
- `MARKETING_QSTASH_PRIMARY_SCHEMA_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?...`
- `MARKETING_MIGRATION_EXPECTED_PG_HOST=HOST` (exact hostname match)
- `MARKETING_MIGRATION_EXPECTED_PG_DATABASE=DATABASE` (exact database name match)

The script uses **only** `MARKETING_QSTASH_PRIMARY_SCHEMA_DATABASE_URL`.

It does **not** read:

- `DATABASE_URL`
- `.env.local`
- application runtime database pools

Host and database checks are preconnection safeguards. They reduce accidental targeting errors but do **not** prove the intended Neon project or branch. Production migration still requires independent owner authorization and operator review of the actual target.

## Dry-run mode

`MARKETING_QSTASH_PRIMARY_SCHEMA_DRY_RUN=report`

- No execution authorization required.
- No database connection.
- No URL parsing or secret loading.
- Reports statement count, object names, and whether execute variables are **supplied** (not their values).

If both dry-run and execute authorization are set, **dry-run wins** and no connection is made.

## Transaction behavior

- One PostgreSQL transaction (`BEGIN` → DDL → schema compatibility verification → `COMMIT`).
- Transaction-scoped advisory lock key: `marketing_qstash_primary_schema_apply`.
- On failure: `ROLLBACK`, sanitized error code, connection released.
- No automatic retry after failure or ambiguous outcome.

## Package script

`npm run marketing:schema:dispatcher-qstash-primary` invokes the migration entry point but **refuses execution** without the execute authorization gate.

## Production sequence

1. H3 implementation and disposable validation (separate authorizations).
2. Independent production migration approval.
3. Authorized one-shot execute with explicit target variables.
4. Post-migration verification (separately authorized).
