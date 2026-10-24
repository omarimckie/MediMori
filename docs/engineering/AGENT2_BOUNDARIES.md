# Agent 2 dispatch boundaries (host)

Agent 2 is an **optional** host daemon. It does not replace plan approval, execution authorization, merge, or deploy.

## What Agent 2 does

- Registers in the disposable worker database (`engineering_agent2_*` SQL ingress).
- Polls for **already authorized** worker-enabled runs when `ENGINEERING_AGENT2_EXECUTE_WORKER=true`.
- Assigns at most one run per agent instance (SQL advisory lock + assignment epochs).
- Extends assignment TTL via fenced heartbeats during worker child execution.
- Invokes the same `scripts/engineering-worker.ts` entry path through `scripts/engineering-worker-launch.mjs` when execute is enabled.

## What Agent 2 does not do

- Plan, approve, or authorize execution (human/control-plane only).
- Modify protected operations (`merge_main`, `production_deploy`, `production_secrets`, etc.).
- Run without `ENGINEERING_AGENT2_ENABLED=true` and a restricted `ENGINEERING_WORKER_DATABASE_URL`.
- Execute workers when `ENGINEERING_AGENT2_EXECUTE_WORKER` is not explicitly `true` (register/heartbeat only).

## Configuration gates

| Variable | Purpose |
|----------|---------|
| `ENGINEERING_AGENT2_ENABLED` | Master enable |
| `ENGINEERING_AGENT2_EXECUTE_WORKER` | Allow assignment + worker child |
| `ENGINEERING_AGENT2_ID` | Stable agent UUID |
| `ENGINEERING_AGENT2_OWNER_TOKEN` | Required when execute is enabled; prevents duplicate host registration |
| `ENGINEERING_WORKER_DATABASE_URL` | Restricted worker role only |

## Recovery semantics

- Expired assignments are swept when safe (no active worker lease / preflight).
- Stale fences fail heartbeats and releases with bounded codes (`assignment_not_found`, etc.).
- Daemon shutdown requests `superseded` release when a child is interrupted.
- Stranded `active` runs still require operator `prepareFreshAttempt` per the operations runbook.

## Local verification (no worker execution)

```bash
node scripts/engineering-test-low-memory.mjs "src/lib/engineering/agent2-*.test.ts"
node scripts/engineering-test-low-memory.mjs "src/lib/engineering/engineering-agent-2-dispatch.contract.test.ts"
```

## Admin API alignment (Option A)

Committed `GET /api/admin/engineering` still inlines `safeEventDetails` in `route.ts`. The follow-up module `admin-engineering-event-details.ts` exposes the same projection for tests. A future one-line route change can delegate to `projectEngineeringAdminEventDetails` without altering the JSON schema. See `docs/engineering/AGENT2_RELEASE_MANIFESTS.md` Group 2.

## Prerequisites before production use

1. Apply migrations 1–8 from `docs/engineering-agent.md`.
2. Apply `sql/engineering-agent-2-dispatch.sql` on the disposable worker database.
3. Configure launcher env file (`.env.engineering-2a.local` or `ENGINEERING_AGENT2_ENV_FILE` on the Agent 2 launcher only).
4. Keep `ENGINEERING_AGENT2_EXECUTE_WORKER=false` until operators intentionally enable dispatch.
