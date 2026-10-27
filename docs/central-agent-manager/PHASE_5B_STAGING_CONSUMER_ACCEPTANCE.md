# Phase 5b — Staging consumer acceptance (operator)

**Disabled by default.** Do not run against Neon without explicit owner authorization for consumer writes.

## Protected audit artifact

| Job ID | Rule |
| --- | --- |
| `job-staging-5a2b-20261026-om` | **Do not claim, modify, or delete** (Phase 5a owner-queue audit) |

Consumer planning excludes this job id in code (`consumer-runtime-safety.ts`). Use a **separate** test job only.

## Target database

| Field | Value |
| --- | --- |
| Project | `aged-brook-70202332` |
| Branch | `br-wispy-river-b7zzwpij` |
| Endpoint | `ep-bitter-flower-b7cz1fzc` |
| Database | `neondb` |

## Required env (when authorized)

| Variable | Value |
| --- | --- |
| `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` | `br-wispy-river-b7zzwpij` |
| `CAM_ORCHESTRATION_POOL_ENABLED` | `true` |
| `CAM_ORCHESTRATION_DATABASE_URL` | staging branch only (secret) |
| `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED` | `true` |
| `CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED` | `true` |
| `CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON` | per-agent tokens (secret) |
| `CAM_CONSUMER_STAGING_HARNESS_ENABLED` | `true` (harness only) |

## Forbidden

- `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_*` enabled
- `CURSOR_API_KEY`
- `CENTRAL_AGENT_MANAGER_DURABLE_SCHEDULER_CLAIMS_ENABLED`
- Live Cursor API calls
- Claiming `job-staging-5a2b-20261026-om`

## Test job id (consumer-only)

`job-staging-5b-consumer-<YYYYMMDD>-<initials>`

Owner must enqueue this job via queue-management **before** consumer claim (separate authorized step), or use pre-authorized owner enqueue in same maintenance window.

## Sequence (authorized)

1. `npm run cam:orchestration-env-check` → all `ok`.
2. `npm run cam:consumer-staging-acceptance-dry-run` → harness preflight only.
3. Identity probe SQL (read-only) on staging branch.
4. Enable consumer + bearer on **single** app instance.
5. `POST` consumer claim → dedicated test job only.
6. `POST` heartbeat (lease renewal).
7. `POST` submit_evidence + `POST` complete.
8. Restart app or reload durable store → `GET` consumer assignments empty; job completed in SQL.
9. `POST` heartbeat with stale fence → **409**.
10. Read-only SQL: audit job still `ready`; consumer test job `completed`.

## Stop conditions

- Identity mismatch.
- Audit job state change.
- Bridge/scheduler flags on.
- Duplicate runner lock conflicts.

## Rollback

Disable consumer flag; remove bearer env; optional delete **consumer test job** rows only (not audit job).

## Offline rehearsal

- `npm run cam:consumer-staging-acceptance-dry-run` — preflight only (no Neon).
- `npm run cam:consumer-staging-acceptance-run` — same preflight (default dry-run).
- Library: `cam-consumer-staging-acceptance-harness.ts` (+ unit tests).
- Live execution requires `CAM_CONSUMER_STAGING_HARNESS_ENABLED=true`, `CAM_CONSUMER_STAGING_EXECUTE_WRITES=true`, explicit `CAM_CONSUMER_STAGING_TEST_JOB_ID`, and operator-owned HTTP steps (not auto-run from CI).
