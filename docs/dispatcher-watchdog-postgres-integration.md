# Dispatcher watchdog — disposable PostgreSQL integration (local)

This document describes how to run **real** PostgreSQL integration tests for the dispatcher watchdog persistence layer and the **QStash verified-primary** persistence layer using an isolated, disposable Docker environment.

## Safety model

Integration tests are **skip-by-default**. The suite is gated on **successful resolution** of the disposable database URL (`tryResolveMarketingDispatcherWatchdogTestDatabaseUrl`), not on env presence alone. They run only when **all** of the following are set and validate:

| Variable | Value |
|----------|--------|
| `MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW` | `disposable-local-only` |
| `MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL` | `postgresql://user:pass@tf-watchdog-pg-<RUN_ID>:5432/<db>` |
| `MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST` | `tf-watchdog-pg-<RUN_ID>` (must match URL hostname) |
| `MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID` | Same `<RUN_ID>` used for Docker resource names |

The resolver (`scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs`) **never** reads `DATABASE_URL`, `POSTGRES_URL`, or `.env.local`.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run test:dispatcher-watchdog` | Fake-DB unit tests only (77 tests) — default `npm test` unchanged |
| `npm run test:dispatcher-watchdog:integration` | Guard tests + Docker JSON fixture tests + **skipped** real-DB suites (watchdog + QStash primary) unless env is set |

Do **not** add the integration file to the default `npm test` script.

### H3 disposable QStash schema integration (separate)

`scripts/qstash-primary-schema-disposable.integration.test.mjs` is **not** included in `npm run test:dispatcher-watchdog:integration` and does **not** run automatically.

Run it only with explicit owner authorization, the same disposable Docker PostgreSQL harness as the 63-test suite, and **H3-only mode** (default wrapper behavior remains the 63-test path):

```powershell
# Same MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_* credentials/images as the 63-test wrapper, plus:
$env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUN_AUTHORIZED = "execute"
$env:MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_H3_SCHEMA_ONLY = "execute"
$env:MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID = "<unique-run-id>"
# ... PG user/password/database, pinned images, esbuild staging root ...
.\scripts\run-dispatcher-watchdog-postgres-integration.ps1
```

Inside the runner this executes `node --test /work/scripts/qstash-primary-schema-disposable.integration.test.mjs` after disposable schema apply. Do **not** run `node --test` on the host against `MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL` (PostgreSQL is not published to the host).

## Schema order (empty database)

1. `sql/marketing-incidents.sql` (via parser in `apply-marketing-incidents-schema.mjs`)
2. `sql/marketing-dispatcher-watchdog.sql` (via `apply-marketing-dispatcher-watchdog-schema.mjs`)
3. `sql/marketing-dispatcher-qstash-primary.sql` (via `apply-marketing-dispatcher-qstash-primary-schema.mjs`)

Disposable application runs all three parsers in one transaction via `scripts/dispatcher-watchdog-apply-schemas-disposable.mjs`.

Do **not** use production schema runners that load `.env.local` against a disposable database. Do **not** run `scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs` against disposable PostgreSQL outside the disposable apply script.

## Docker design (future execution)

- PostgreSQL **16** image pinned by digest
- User-defined network with `internal: true`
- Containers: `tf-watchdog-pg-<RUN_ID>`, optional `tf-watchdog-runner-<RUN_ID>`
- **No** published host ports, **no** host networking, **no** Docker socket in runner
- **No** bind mounts of `.env`, `.env.local`, `.git`, or full repository

Runner file allowlist is **enforced in code** (`scripts/dispatcher-watchdog-runner-snapshot.mjs`). Curated copy into an ephemeral build context:

- `package.json`, `package-lock.json` (pre-baked offline image preferred)
- `sql/marketing-incidents.sql`, `sql/marketing-dispatcher-watchdog.sql`, `sql/marketing-dispatcher-qstash-primary.sql`
- `scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs`
- `scripts/apply-marketing-incidents-schema.mjs`
- `scripts/apply-marketing-dispatcher-watchdog-schema.mjs`
- `scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs`
- `scripts/apply-marketing-web-push-schema.mjs` (stripSqlLineComments dependency only)
- `src/lib/marketing/reliability/dispatcher-watchdog/**` (watchdog module)
- `src/lib/marketing/reliability/qstash-primary/**` (QStash primary module + integration test)
- `src/lib/marketing/credential-health/heartbeat-store-pool.ts` (transitive import for `recordVerifiedPrimaryHeartbeatInLock`; integration tests call `recordVerifiedPrimaryHeartbeat` on a disposable pool client)
- `src/lib/marketing/incidents/sanitize.ts`, `types.ts` (transitive imports for incident adapter)

Offline runner `node_modules` closure roots: `tsx`, `pg`, `@neondatabase/serverless`, `@upstash/qstash` (plus transitive dependencies, staged offline — no runtime `npm install`).

Reject symlinks that escape the allowlist.

## Isolation verification

- Node: `scripts/dispatcher-watchdog-docker-isolation.mjs` + fixtures under `scripts/fixtures/dispatcher-watchdog/`
- PowerShell: `scripts/Assert-DispatcherWatchdogDockerIsolation.ps1`

## Wrapper

`scripts/run-dispatcher-watchdog-postgres-integration.ps1` implements the full disposable lifecycle when `MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUN_AUTHORIZED=execute` is set. Required additional configuration:

| Variable | Purpose |
|----------|---------|
| `MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_POSTGRES_IMAGE` | `postgres:16@sha256:…` (digest required) |
| `MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_RUNNER_IMAGE` | `node:<version>@sha256:…` (digest required) |
| `MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_USER` | Disposable DB user |
| `MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_PASSWORD` | Disposable DB password |
| `MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_PG_DATABASE` | Disposable DB name |
| `MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID` | Run id for resource names and URL binding |

The wrapper verifies git root/branch/HEAD, builds the curated runner workspace (offline `node_modules` closure), creates an internal Docker network, starts unpublishd PostgreSQL and runner containers, validates inspect JSON (including `Ports` null = exposed-but-unpublished), applies schemas via `dispatcher-watchdog-apply-schemas-disposable.mjs`, runs **both** integration files inside the runner in one `tsx --test` invocation:

- `src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts` (42 cases)
- `src/lib/marketing/reliability/qstash-primary/qstash-primary-postgres.integration.test.ts` (21 cases)

Together these are **63** PostgreSQL integration tests (historical validation target).

Failure in either suite fails the wrapper (native exit code propagation). The wrapper then removes **only** tracked container/network/volume IDs and verifies they are gone.

## QStash primary integration scope (disposable DB)

The QStash suite exercises schema application, `jti` deduplication, untrusted message-id metadata, concurrency across connections, transaction rollback, primary singleton row, monotonic timestamps, advisory locking, unique constraints, and connection cleanup. It does **not** call `Receiver.verify()` or exercise production `DATABASE_URL` / `recordVerifiedPrimaryHeartbeatInLock` pool routing.

## Cleanup

Remove only resources named `tf-watchdog-*-<RUN_ID>` and registered in the run ledger. Do not run `docker system prune`. Database integration case 26 was removed; cleanup verification is **wrapper-level** (resource ID tracking + post-removal inspect), not an in-process env check.
