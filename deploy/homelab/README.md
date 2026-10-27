# CAM homelab deployment package (NUC13 / Proxmox) — offline templates

**Disabled by default.** Do not install until Phase 5c owner authorization.

## Contents

| File | Purpose |
| --- | --- |
| `cam-bridge-runner.service.example` | systemd unit template |
| `cam-bridge.env.example` | Environment template (no secrets) |
| `cam-offline-fake-transport-acceptance.sh.example` | Pre-enable runner checklist |

## VM prerequisites (Ubuntu)

- Node.js 20+ LTS, npm, git
- Dedicated Unix user `medimori` (no login shell for production if using systemd only)
- Outbound HTTPS to app host consumer URL only; Cursor API blocked until Phase 5d
- Read-only optional: staging Postgres via pooler (runner does **not** need direct SQL if using consumer HTTP only)

## Filesystem layout

```
/opt/medimori/                 # application checkout (WorkingDirectory)
/etc/medimori/cam-bridge.env   # root-owned 0600 secrets
/var/lib/medimori/             # lock, budget, emergency-stop files
/var/log/medimori/             # runner logs (journald preferred)
```

## Security

- `cam-bridge.env` mode `0600`, owner root or `medimori`
- Consumer bearer in env file; **never** store `CURSOR_API_KEY` until Phase 5d
- `CURSOR_BRIDGE_RUNNER_LOCK_FILE` under `/var/lib/medimori/`
- `CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE` — create to halt cycles
- systemd `MemoryMax`, `CPUQuota` in service example

## Network isolation

- Runner → app `CURSOR_BRIDGE_CONSUMER_BASE_URL` only
- No inbound ports required on homelab VM
- Firewall deny egress except app host + package mirrors

## Health

- `cursor-bridge-runner-health.ts` diagnostics (offline tests)
- systemd `Restart=on-failure` with `RestartSec=30`

## Rollback

1. `systemctl stop cam-bridge-runner`
2. Set `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED=false`
3. Remove emergency stop / lock files as needed
4. Revoke bearer token on app host

## Reboot recovery

- systemd `WantedBy=multi-user.target` — runner restarts; must re-acquire lock; assignments recovered via consumer reload + lease reconcile on app host.
