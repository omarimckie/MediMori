# CAM orchestration — database operations

Operator-facing notes for durable queue PostgreSQL/Neon usage. **Never commit connection strings or credentials.**

## Neon projects (non-secret identifiers)

| Purpose | Project name | Project ID |
| --- | --- | --- |
| CAM staging / orchestration | `central-agent-manager-staging` | `aged-brook-70202332` |
| MediMori product DB (marketing, engineering worker) | `twilightFeather` | `solitary-leaf-77946642` |

CAM approval adapter activation **must not** use `solitary-leaf-77946642` (enforced in `config-validation.ts`).

## Environment variables

| Variable | Use |
| --- | --- |
| `CAM_ORCHESTRATION_DATABASE_URL` | Live durable queue when `CAM_ORCHESTRATION_POOL_ENABLED=true` |
| `CAM_ORCHESTRATION_POOL_ENABLED` | Must be `true` for the app to use `CAM_ORCHESTRATION_DATABASE_URL` (default off) |
| `CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL` | **Local/CI only** — `orchestration-postgres-pool.integration.test.ts` and `orchestration-postgres-owner-writable.integration.test.ts` |
| `CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID` | Optional; defaults to `aged-brook-70202332` |
| `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` | **Required** when `CAM_ORCHESTRATION_POOL_ENABLED=true` and live URL is set; must match DB probe |
| `CAM_APPROVAL_*` | Separate approval adapter disposable verification (not orchestration queue tables) |

Do not point disposable pool-test URLs at production/staging `main` or at twilightFeather.

**Staging orchestration (Phase 5+):** create a **separate** branch on `aged-brook-70202332` for `CAM_ORCHESTRATION_DATABASE_URL`. Do not reuse the disposable integration-test branch (`br-withered-dream-b71r3mo0`).

**Example disposable branch (Pass 4E):** `cam-orchestration-pool-4e-20261025` (`br-withered-dream-b71r3mo0`, endpoint `ep-nameless-dream-b7hvelbo`) on `aged-brook-70202332`.

Load disposable URLs from a **gitignored** file (for example `.env.cam-orchestration-disposable.local`) into the shell process only.

## Staging configuration guards

`orchestration-env-safeguards.ts` rejects known-bad live endpoints (twilightFeather / disposable hosts). That is not sufficient alone: `orchestration-staging-identity.ts` requires `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` and, on connect, compares `current_setting('neon.project_id')` and `current_setting('neon.branch_id')` to configured expectations.

`createOrchestrationSqlPortFromEnv` runs offline env diagnostics, then the identity probe, before queue use.

Offline check (no network): `npm run cam:orchestration-env-check`.

Phase 5a-2 runbook: [PHASE_5A_STAGING_RUNBOOK.md](./PHASE_5A_STAGING_RUNBOOK.md).

## Owner vs durable consumer concurrency

| Writer | Typical process | Safe persistence |
| --- | --- | --- |
| **Durable consumer** (agent HTTP API, bridge runner) | Claims, heartbeats, dispatch correlation, completion | Fence-guarded assignment+job updates (`updateAssignmentWithJobIfFence`, `tryClaimReadyJob`, idempotent complete) |
| **Owner queue management** | Readiness refresh, scheduler tick, cancel/bind approval | Reload from SQL before mutate; job rows use `upsertJobIfOwnerWritable` (skips `running`/`assigned` jobs and any job with an **active** assignment) |

**Do not** run owner `refreshDependencyReadiness`, `runScheduler`, or `recoverFromCrash` against the same database while a bridge runner or agent consumer is actively mutating assignments.

`createPostgresOrchestrationQueuePort` is **deprecated** for owner mutations; use `createDurableOrchestrationQueueStore`.

## Crash recovery (`recoverFromCrash`)

- Not exposed on HTTP routes in the current tree; callable only via `OrchestrationQueuePort` in-process.
- Before invoking: stop the bridge runner (`CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE`), confirm no active consumer, clear stale lock if needed.
- Recovery uses fenced writes for previously active assignments; rejects when consumer-owned job rows cannot be updated.
- After recovery, run readiness refresh only when no concurrent consumer is active.

## Bridge activation prerequisites

1. Orchestration SQL applied on the intended staging branch (`sql/central-agent-manager-orchestration.sql`).
2. Disposable PostgreSQL integration tests green on an isolated branch (`CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL`; pool tests scope assertions per job id).
3. `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED=true`, consumer + bridge flags enabled deliberately.
4. `CAM_ORCHESTRATION_DATABASE_URL` targets **CAM staging** project, not twilightFeather production.
5. Approval adapter disposable 38-case harness still required before approval route activation (separate gate).

## Disposable branch cleanup

- Pool tests apply idempotent DDL and leave rows in `central_agent_manager.orchestration_*` (no test teardown).
- After evidence capture: `TRUNCATE` orchestration tables on the disposable branch or delete the branch in Neon console.
- Revoke credentials issued for disposable branches when done.
