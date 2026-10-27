# Cursor bridge runner (homelab supervised Node)

The bridge runner is a **standalone Node process** that loops on `runCursorBridgeAssignmentCycle` against the CAM agent consumer API (in-process harness in tests; HTTP in deployment).

## Defaults

- **Disabled** unless `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED=true`.
- Requires `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED=true`, durable queue, and agent consumer configuration.
- **No live Cursor calls** in CI — tests inject `FakeCursorCloudApiTransport`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED` | Master runner switch (default off). |
| `CURSOR_BRIDGE_RUNNER_ID` | Stable runner identity (8–80 chars). |
| `CURSOR_BRIDGE_DISPATCH_OWNER_ID` | Dispatch intent owner token (must match bridge instance). |
| `CURSOR_BRIDGE_PROJECT_TARGETS_JSON` | JSON array of `{ projectId, repoUrl, startingRef? }`. |
| `CURSOR_BRIDGE_RUNNER_LOCK_FILE` | Singleton lock file path (default `.local/cursor-bridge-runner.lock.json`). |
| `CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE` | Touch/create this file to pause the runner. |
| `CURSOR_BRIDGE_RUNNER_BUDGET_FILE` | Persists daily create + hourly cycle counters. |
| `CURSOR_BRIDGE_RUNNER_DAILY_CREATE_BUDGET` | Max Cursor creates per UTC day (default 24). |
| `CURSOR_BRIDGE_RUNNER_HOURLY_CYCLE_LIMIT` | Max bridge cycles per hour (default 60). |
| `CURSOR_BRIDGE_RUNNER_IDLE_MIN_MS` / `CURSOR_BRIDGE_RUNNER_IDLE_MAX_MS` | Idle backoff when no jobs are claimable. |
| `CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT` | When `true`, uses `FakeCursorCloudApiTransport` and in-process consumer only (no `CURSOR_API_KEY`). |
| `CURSOR_BRIDGE_CONSUMER_BASE_URL` | Base URL for HTTP consumer mode (required when offline fake transport is `false`). |

See `.env.example` for Cursor REST and consumer bearer settings.

## Homelab deployment (manual)

1. Provision env on the homelab host (never commit secrets).
2. Enable durable orchestration + consumer + bridge + runner flags on **one** supervised service (systemd, Docker, or PM2).
3. Ensure only **one** runner instance uses the same lock file and dispatch owner id.
4. Point `CAM_ORCHESTRATION_DATABASE_URL` at the durable queue (disposable branch for staging).
5. Start with `npm run cursor-bridge:runner` (or `tsx scripts/cursor-bridge-runner.ts`).
6. Monitor sanitized health snapshots via runner logs (no bearer tokens or API keys).

## Daily create budget

The runner **reserves** one daily create slot (atomic budget file write) immediately before `createAgentWithInitialRun`. Ambiguous or failed creates after the request is sent still consume the reservation so a restart cannot regain capacity for a potentially executed create.

Poll-only resumes (owner-confirmed external ids) do not reserve create capacity.

## Stale singleton lock

The lock file is created with exclusive `wx` semantics. If a runner crashes, the lock file may remain until an operator deletes it manually. The runner does **not** delete locks based on age or PID alone. Only the owning `runnerId` releases the lock on graceful shutdown.

## Emergency stop

Create the emergency stop file configured by `CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE`. The runner exits the loop with `emergency_stop` before starting new cycles. Remove the file before restarting.

## Known limitations

- Singleton lock is **advisory** (file-based); host clock skew and stale PID records require operator cleanup.
- Budget files are not transactional with SQL assignment state.
- Owner scheduler/readiness must not overlap an active consumer on the same database; see [ORCHESTRATION_DATABASE_OPS.md](./ORCHESTRATION_DATABASE_OPS.md).

## Crash recovery and maintenance

Do not call `recoverFromCrash` while this runner (or any agent consumer) is active on the same `CAM_ORCHESTRATION_DATABASE_URL`. Stop the runner (emergency stop file), wait for in-flight consumer requests to finish, then run recovery from an owner-only process.

## Release prerequisites

- Pass 1 durable consumer concurrency committed and validated.
- Disposable PostgreSQL pool tests green (`CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL`).
- Owner enables runner + recovery flags deliberately; keep recovery API off in production until reviewed.
