# Homelab CAM deployment plan (NUC13 / Proxmox) — preparation only

Activation waits on Phase 5a staging smoke and Phase 5c offline runner acceptance. **No install steps are executed by the repo.**

## Prerequisites

| Gate | Evidence |
| --- | --- |
| 5a-2B queue smoke | `PHASE_5B_QUEUE_SMOKE_PROCEDURE.md` |
| Offline CAM tests | `npm run test:central-agent-manager` (PG URLs unset) |
| Fake transport runner | `cursor-bridge-runner-entrypoint.test.ts` |
| Env preflight | `npm run cam:orchestration-env-check` |

## Proxmox isolation

- Dedicated VM or LXC (Ubuntu 22.04+), separate VLAN or firewall zone from production LAN.
- No inbound ports unless consumer HTTP is served from homelab (prefer app-hosted consumer + outbound runner).
- Egress allowlist: CAM consumer base URL, Cursor API (later phase only).

## Runtime

- Node.js 20+ LTS, `npm ci` at pinned lockfile SHA.
- Checkout: `integration/candidate-cam-manager-only` at reviewed commit.
- Process user: non-root `medimori` with read-only app tree, writable only `CURSOR_BRIDGE_RUNNER_*` state paths.

## PostgreSQL / Neon

- TLS connection string in `/etc/medimori/cam-bridge.env` (0600).
- Same staging identity vars as app: `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID`, pool flags.
- No product DB URLs on homelab host.

## Runtime separation (app host vs homelab)

| Component | Typical host | Credentials |
| --- | --- | --- |
| Next.js + consumer HTTP routes | App/staging host | `CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON` (agent→app) |
| Cursor bridge runner | NUC13 VM | `CURSOR_API_KEY` (runner→Cursor, Phase 5d+) + consumer bearer to call app |
| Owner queue management | App host | Admin session only |

Homelab outage: consumer leases expire via `reconcileLeases`; runner emergency stop prevents new external dispatch. Duplicate runners blocked by `CURSOR_BRIDGE_RUNNER_LOCK_FILE`. Offline proof: `CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT=true` tests.

## Secrets

- `CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON` per agent (never share with Cursor API key).
- `CURSOR_API_KEY` unset until Phase 5d.
- Emergency stop: `CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE`.
- Lock: `CURSOR_BRIDGE_RUNNER_LOCK_FILE`.
- Budget: `CURSOR_BRIDGE_RUNNER_BUDGET_FILE`.

## Supervision

- Template: `deploy/homelab/cam-bridge-runner.service.example` (commented; enable only after authorization).
- `Restart=on-failure`, `MemoryMax`, `CPUQuota`.
- Logs: journald + optional forwarder; never log bearer tokens or database URLs.

## Health checks

- Process alive + lock file owned by runner id.
- Emergency stop file absent.
- Optional: HTTP consumer `GET /assignments` with bearer (read-only) from localhost cron.

## Reboot recovery

- `systemctl enable` only after successful dry run.
- On boot: unit starts single runner; lock prevents duplicate.
- Operator verifies budget file and stop file before re-enabling live Cursor.

## Rollback

- Set `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED=false`.
- Touch emergency stop file.
- Stop systemd unit; preserve budget/lock files for forensics.

## Related

- [NUC13_PROXMOX_BRIDGE_RUNBOOK.md](./NUC13_PROXMOX_BRIDGE_RUNBOOK.md)
- [CURSOR_BRIDGE_RUNNER.md](./CURSOR_BRIDGE_RUNNER.md)
