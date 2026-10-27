# Phase 5a-2B — Owner durable queue smoke (executable procedure)

**Prerequisites:** [PHASE_5A_STAGING_PROVISIONING_CHECKLIST.md](./PHASE_5A_STAGING_PROVISIONING_CHECKLIST.md) complete.

**Does not** start scheduler, bridge, or consumer. Queue management handler does not call `runScheduler` or `recoverFromCrash`.

## Job id convention

Use one unique id per run:

`job-staging-5a2b-YYYYMMDD-<operator-initials>`

## Required runtime env (**APPROVAL** to enable against Neon)

| Variable | Value |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_ENABLED` | `true` |
| `CENTRAL_AGENT_MANAGER_OWNER_USERNAMES` | owner admin username |
| `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED` | `true` |
| `CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED` | `true` |
| `CAM_ORCHESTRATION_POOL_ENABLED` | `true` |
| `CAM_ORCHESTRATION_DATABASE_URL` | staging branch (secret) |
| `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` | provisioned `br-…` |

## Forbidden (must remain off/unset)

- `CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED`
- `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED`
- `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED`
- `CENTRAL_AGENT_MANAGER_DURABLE_SCHEDULER_CLAIMS_ENABLED`
- `CURSOR_API_KEY`
- `CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL`

Offline guard reference: `orchestration-operational-guards.ts` (`diagnoseQueueSmokeForbiddenFlags`).

## Preflight (safe before `next dev`)

```bash
npm run cam:orchestration-env-check
```

## Single-owner runtime (**APPROVAL**)

1. One terminal: `npm run dev` (or one staging instance).
2. No bridge runner, no second owner process, no cron invoking scheduler.

## Authentication

Sign in as owner admin (session cookie used by `getAuthenticatedAdminUsername`).

## HTTP steps

Base path: `/api/admin/central-agent-manager/queue/manage`

### 1. GET

Expect `200`, body includes `"durable":true`, `"managementEnabled":true`.

### 2. POST enqueue

```json
{
  "action": "enqueue",
  "id": "<job-staging-5a2b-…>",
  "projectId": "medimori",
  "goalId": "goal-staging-5a2b",
  "description": "Phase 5a-2B durable queue smoke"
}
```

Expect `200` and `{ "job": { "id": "…", "state": "ready", … } }`.

### 3. GET list

Job visible under `queuedByProject.medimori`.

### 4. Durability check

Restart `next dev` (or new process with same env). GET again — job still listed.

### 5. Read-only DB (**APPROVAL**)

```sql
SELECT id, project_id, state
FROM central_agent_manager.orchestration_jobs
WHERE id = '<job-staging-5a2b-…>';
```

Identity probe must still match expected project/branch.

## Acceptance criteria

- All HTTP steps pass with owner auth.
- Row exists in `orchestration_jobs`.
- No consumer/bridge flags enabled during test.
- `job_count` increased by 1 from provisioning baseline (if baseline recorded).

## Rollback

Disable durable/management/pool flags; remove live URL from env. Optional row delete on staging branch only.
