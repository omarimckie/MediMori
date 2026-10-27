# NUC13 Proxmox — Cursor bridge runner (offline preparation)

Homelab activation is **out of scope** until staging durable queue smoke (Phase 5a-2) succeeds. This runbook collects offline preparation only.

## Target host

- **Hardware:** Intel NUC13 (or equivalent) on Proxmox.
- **Role:** Supervised Node process for `npm run cursor-bridge:runner` — not the Next.js app unless consumer HTTP mode is used.

## VM / LXC checklist (prepare, do not start yet)

1. Node.js LTS matching development (20+).
2. Git checkout of MediMori integration branch at reviewed SHA.
3. `npm ci` (or production `node_modules` sync per your deploy pattern).
4. Secrets directory outside git: owner env file with **no** commit to repo.

## Required env (when authorized — later phase)

| Variable | Notes |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED` | `true` |
| `CAM_ORCHESTRATION_POOL_ENABLED` | `true` |
| `CAM_ORCHESTRATION_DATABASE_URL` | Staging orchestration branch (see [ORCHESTRATION_DATABASE_OPS.md](./ORCHESTRATION_DATABASE_OPS.md)) |
| `CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED` | `true` when using HTTP consumer to app |
| `CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON` | Per-agent tokens |
| `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED` | `true` only after offline fake-transport passes |
| `CURSOR_BRIDGE_RUNNER_LOCK_FILE` | Persistent path on VM disk |
| `CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE` | Operator kill switch |
| `CURSOR_BRIDGE_RUNNER_BUDGET_FILE` | Daily create budget state |

Keep `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED` and `CURSOR_API_KEY` **unset** until explicit live-Cursor authorization.

## Supervision options

- **systemd** unit: `ExecStart=npm run cursor-bridge:runner`, `Restart=on-failure`, `EnvironmentFile=-/etc/medimori/cam-bridge.env`.
- **PM2** or Docker: single instance only; same lock file semantics as [CURSOR_BRIDGE_RUNNER.md](./CURSOR_BRIDGE_RUNNER.md).

## Offline validation before homelab

1. `npm run test:central-agent-manager` (disposable PG URL unset).
2. `CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT=true` local runner cycle tests (see cursor-bridge runner tests).
3. `npm run cam:orchestration-env-check` with staging env template.

## Network

- Outbound HTTPS to Cursor API (later) and to CAM consumer base URL (`CURSOR_BRIDGE_CONSUMER_BASE_URL`) if not in-process.
- No inbound requirements unless the app serves consumer routes on the homelab.

## Safety

- One runner per `CURSOR_BRIDGE_DISPATCH_OWNER_ID` and lock file.
- Emergency stop file checked each cycle.
- Do not run `recoverFromCrash` while runner is active on the same database.

## Extended deployment plan

See [HOMELAB_CAM_DEPLOYMENT_PLAN.md](./HOMELAB_CAM_DEPLOYMENT_PLAN.md) for Proxmox isolation, secrets, systemd template (`deploy/homelab/cam-bridge-runner.service.example`), resource limits, reboot recovery, and rollback.
