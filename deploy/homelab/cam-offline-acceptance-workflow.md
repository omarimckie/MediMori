# CAM homelab offline acceptance workflow (Ubuntu VM / Proxmox)

**Disabled by default.** No service install in this document — operator runs from a dev checkout.

## 1. VM prerequisites

- Ubuntu 22.04+ guest on Proxmox (NUC13 host).
- Node.js 20 LTS, `git`, `npm ci` at repo root.
- User `medimori` (system user) — see `ubuntu-vm-setup.sh.example` (not executed by CI).

## 2. Network isolation

- Egress allow: package mirrors + app consumer base URL only.
- Deny: `api.cursor.com`, Neon pooler (unless later phase explicitly enables).
- Unset `CURSOR_API_KEY` and `CAM_ORCHESTRATION_DATABASE_URL` for offline acceptance.

## 3. Filesystem

| Path | Mode | Purpose |
| --- | --- | --- |
| `/opt/medimori/app` | `medimori:medimori` | Checkout |
| `/etc/medimori/cam-bridge.env` | `0600` | Secrets template |
| `/var/lib/medimori/` | `0750` | Lock, budget, emergency-stop |
| `/var/log/medimori/` | `0750` | Optional file logs (journald preferred) |

## 4. Offline acceptance command

From repo root on the VM (or dev machine):

```bash
npm run cam:homelab-offline-acceptance
npm run cam:phase6b-offline-acceptance
npm run cam:phase6c-offline-acceptance
npm run cam:phase6d-offline-acceptance
npm run cam:phase6e-offline-acceptance
npm run cam:phase6f-offline-acceptance
npm run cam:phase6g-offline-acceptance
```

### Phase 6f durable integration (developer machine / NUC13 checkout)

| Step | Command |
| --- | --- |
| PGlite SQL objective/queue/budget | `npm run cam:phase6e-offline-acceptance` |
| Budget dispatch + approval SQL snapshot | `npm run cam:phase6f-offline-acceptance` |
| Genuine fake-worker workflow | `CAM_NUC13_FAKE_WORKER_DEMO=1 npm run cam:fake-worker-workflow-demo` |
| Legacy wrapper | `CAM_NUC13_FAKE_WORKER_DEMO=1 npm run cam:nuc13-fake-worker-demo` |

Server PostgreSQL (owner only): see `docs/central-agent-manager/disposable-postgres-acceptance.md`.

Expect JSON: `{"ok":true,"code":"homelab_offline_acceptance",...}`, `phase6b_offline_acceptance`, and `phase6c_offline_acceptance` with zero failing tests.

### Phase 6c durable manager

| Check | Command / expectation |
| --- | --- |
| Node | 20 LTS (`node -v`) |
| Isolated dir | `/tmp/cam-6c-acceptance` or `%TEMP%\\cam-6c-acceptance` |
| Guards | `CURSOR_API_KEY` unset; `CAM_ORCHESTRATION_DATABASE_URL` unset |
| Demo (disabled) | `npm run cam:nuc13-fake-worker-demo` prints guard message unless `CAM_NUC13_FAKE_WORKER_DEMO=1` |
| Logs | test stdout; runner logs under `/var/log/medimori/` when service enabled later |
| Emergency stop | `touch /var/lib/medimori/emergency-stop` (see `cam-bridge.env.example`) |
| Rollback | Delete isolated test dir; no service changes in offline mode |

### Phase 6b manager (queue-backed objective)

| Requirement | Value |
| --- | --- |
| `CURSOR_API_KEY` | unset |
| `CAM_ORCHESTRATION_DATABASE_URL` | unset |
| Bridge / consumer | not required for `cam:phase6b-offline-acceptance` |

**Rollback:** no VM changes; re-run Phase 6a acceptance only if 6b fails.

**Safety:** scripts use in-memory orchestration and fake specialist transport only.

## 5. Runner controls (when enabled later)

| Control | Mechanism |
| --- | --- |
| Lock | `CURSOR_BRIDGE_RUNNER_LOCK_FILE` |
| Budget | `CURSOR_BRIDGE_RUNNER_BUDGET_FILE` |
| Emergency stop | Create `CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE` |
| SIGTERM | systemd `KillSignal=SIGTERM`, `TimeoutStopSec=120` |

## 6. Health checks

- Offline: homelab acceptance script (this phase).
- Future online: HTTP consumer heartbeat + `cursor-bridge-runner-health` diagnostics.

## 7. Backup before enable

- Copy `/etc/medimori/cam-bridge.env`, `/var/lib/medimori/budget.json`, lock path metadata.
- Restic job on backup NUC — see `backup-monitoring-nuc13.md`.

## 8. Rollback

1. Stop unit (when installed): `systemctl stop cam-bridge-runner`
2. Set `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED=false`
3. Remove emergency-stop trigger if set
4. Revoke consumer bearer on app host
5. Restore env file from Restic snapshot if needed

## 9. Pass / fail

| Result | Criteria |
| --- | --- |
| **Pass** | `cam:homelab-offline-acceptance` exit 0; `cam:orchestration-env-check` ok |
| **Fail** | Any failing test, non-empty `CURSOR_API_KEY`, or staging DB URL in env |
